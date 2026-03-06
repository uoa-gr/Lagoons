-- =============================================================================
-- Greek Lagoons WebGIS - Database Schema & API Functions
-- Supabase Project: gemokuqzdurkkgkyseix
-- =============================================================================
-- Run this entire script in the Supabase SQL Editor.
-- It creates the lagoons table, polygon storage, indexes, RLS, and all RPC
-- functions used by the frontend.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. ENABLE PostGIS (if not already enabled)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;


-- ---------------------------------------------------------------------------
-- 2. TABLE: lagoons
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lagoons (
    id               SERIAL PRIMARY KEY,

    -- Identifiers / names
    name_en          TEXT,
    name_gr          TEXT,

    -- Location
    location_en      TEXT,    -- Prefecture / regional unit (e.g. "Kerkyra")
    island_en        TEXT,    -- Island name (e.g. "Corfu", "Crete")

    -- Morphometrics  (original units from shapefile)
    length_m         DOUBLE PRECISION,   -- max length (m)
    width_m          DOUBLE PRECISION,   -- max width (m)
    height_m         DOUBLE PRECISION,   -- max height above MSL (m)
    perimeter_km2    DOUBLE PRECISION,   -- perimeter (km²)
    area_km2         DOUBLE PRECISION,   -- area (km²)

    -- Sea-level rise projections (m)
    rcp2_6_slr       DOUBLE PRECISION,   -- SLR under RCP 2.6
    rcp8_5_slr       DOUBLE PRECISION,   -- SLR under RCP 8.5
    rcp2_6_vec_slr   DOUBLE PRECISION,   -- Vector SLR under RCP 2.6
    rcp8_5_vec_slr   DOUBLE PRECISION,   -- Vector SLR under RCP 8.5

    -- Inundation flags  (stored as text "yes"/"no")
    rcp2_6_inundated TEXT,   -- "yes" / "no"
    rcp8_5_inundated TEXT,   -- "yes" / "no"
    rcp2_6_vec_inundated TEXT,
    rcp8_5_vec_inundated TEXT,

    -- Data quality
    data_quality     TEXT,   -- e.g. "ok" / "no data"

    -- Geometry - polygon in WGS84
    geom             GEOMETRY(GEOMETRY, 4326),

    -- Centroid coordinates (pre-computed for fast marker queries)
    centroid_lat     DOUBLE PRECISION,
    centroid_lng     DOUBLE PRECISION,

    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial index on polygon geometry
CREATE INDEX IF NOT EXISTS lagoons_geom_idx        ON public.lagoons USING GIST (geom);
-- Regular indexes for common filters
CREATE INDEX IF NOT EXISTS lagoons_location_idx    ON public.lagoons (location_en);
CREATE INDEX IF NOT EXISTS lagoons_island_idx      ON public.lagoons (island_en);
CREATE INDEX IF NOT EXISTS lagoons_name_idx        ON public.lagoons (name_en);
CREATE INDEX IF NOT EXISTS lagoons_rcp26_idx       ON public.lagoons (rcp2_6_inundated);
CREATE INDEX IF NOT EXISTS lagoons_rcp85_idx       ON public.lagoons (rcp8_5_inundated);


-- ---------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY  (read-only public access)
-- ---------------------------------------------------------------------------
ALTER TABLE public.lagoons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read" ON public.lagoons;
CREATE POLICY "Allow public read"
    ON public.lagoons
    FOR SELECT
    TO anon
    USING (true);


-- ---------------------------------------------------------------------------
-- 4. RPC: api_lagoons_count
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_lagoons_count()
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT COUNT(*)::INTEGER FROM public.lagoons;
$$;


-- ---------------------------------------------------------------------------
-- 5. RPC: api_lagoons_markers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_lagoons_markers(
    p_name_en          TEXT    DEFAULT NULL,
    p_location_en      TEXT    DEFAULT NULL,
    p_island_en        TEXT    DEFAULT NULL,
    p_rcp2_6_inundated TEXT    DEFAULT NULL,
    p_rcp8_5_inundated TEXT    DEFAULT NULL
)
RETURNS TABLE (
    id               INTEGER,
    name_en          TEXT,
    location_en      TEXT,
    island_en        TEXT,
    area_km2         DOUBLE PRECISION,
    height_m         DOUBLE PRECISION,
    rcp2_6_inundated TEXT,
    rcp8_5_inundated TEXT,
    rcp2_6_slr       DOUBLE PRECISION,
    rcp8_5_slr       DOUBLE PRECISION,
    centroid_lat     DOUBLE PRECISION,
    centroid_lng     DOUBLE PRECISION
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT
        l.id, l.name_en, l.location_en, l.island_en,
        l.area_km2, l.height_m,
        l.rcp2_6_inundated, l.rcp8_5_inundated,
        l.rcp2_6_slr, l.rcp8_5_slr,
        l.centroid_lat, l.centroid_lng
    FROM public.lagoons l
    WHERE
        (p_name_en          IS NULL OR l.name_en          = p_name_en)
        AND
        (p_location_en      IS NULL OR l.location_en      = p_location_en)
        AND (p_island_en    IS NULL OR l.island_en        = p_island_en)
        AND (p_rcp2_6_inundated IS NULL OR l.rcp2_6_inundated = p_rcp2_6_inundated)
        AND (p_rcp8_5_inundated IS NULL OR l.rcp8_5_inundated = p_rcp8_5_inundated)
    ORDER BY l.name_en;
$$;


-- ---------------------------------------------------------------------------
-- 6. RPC: api_lagoons_polygons
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_lagoons_polygons(
    p_name_en          TEXT    DEFAULT NULL,
    p_location_en      TEXT    DEFAULT NULL,
    p_island_en        TEXT    DEFAULT NULL,
    p_rcp2_6_inundated TEXT    DEFAULT NULL,
    p_rcp8_5_inundated TEXT    DEFAULT NULL
)
RETURNS TABLE (
    id               INTEGER,
    name_en          TEXT,
    location_en      TEXT,
    island_en        TEXT,
    area_km2         DOUBLE PRECISION,
    rcp2_6_inundated TEXT,
    rcp8_5_inundated TEXT,
    geojson          TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT
        l.id, l.name_en, l.location_en, l.island_en,
        l.area_km2, l.rcp2_6_inundated, l.rcp8_5_inundated,
        ST_AsGeoJSON(l.geom)::TEXT AS geojson
    FROM public.lagoons l
    WHERE
        l.geom IS NOT NULL
        AND (p_name_en          IS NULL OR l.name_en          = p_name_en)
        AND (p_location_en      IS NULL OR l.location_en      = p_location_en)
        AND (p_island_en        IS NULL OR l.island_en        = p_island_en)
        AND (p_rcp2_6_inundated IS NULL OR l.rcp2_6_inundated = p_rcp2_6_inundated)
        AND (p_rcp8_5_inundated IS NULL OR l.rcp8_5_inundated = p_rcp8_5_inundated)
    ORDER BY l.name_en;
$$;


-- ---------------------------------------------------------------------------
-- 7. RPC: api_lagoons_details
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_lagoons_details(p_id INTEGER)
RETURNS TABLE (
    id                   INTEGER,
    name_en              TEXT,
    name_gr              TEXT,
    location_en          TEXT,
    island_en            TEXT,
    length_m             DOUBLE PRECISION,
    width_m              DOUBLE PRECISION,
    height_m             DOUBLE PRECISION,
    perimeter_km2        DOUBLE PRECISION,
    area_km2             DOUBLE PRECISION,
    rcp2_6_slr           DOUBLE PRECISION,
    rcp8_5_slr           DOUBLE PRECISION,
    rcp2_6_vec_slr       DOUBLE PRECISION,
    rcp8_5_vec_slr       DOUBLE PRECISION,
    rcp2_6_inundated     TEXT,
    rcp8_5_inundated     TEXT,
    rcp2_6_vec_inundated TEXT,
    rcp8_5_vec_inundated TEXT,
    data_quality         TEXT,
    centroid_lat         DOUBLE PRECISION,
    centroid_lng         DOUBLE PRECISION,
    geojson              TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT
        id, name_en, name_gr, location_en, island_en,
        length_m, width_m, height_m, perimeter_km2, area_km2,
        rcp2_6_slr, rcp8_5_slr, rcp2_6_vec_slr, rcp8_5_vec_slr,
        rcp2_6_inundated, rcp8_5_inundated,
        rcp2_6_vec_inundated, rcp8_5_vec_inundated,
        data_quality, centroid_lat, centroid_lng,
        ST_AsGeoJSON(geom)::TEXT AS geojson
    FROM public.lagoons
    WHERE id = p_id;
$$;


-- ---------------------------------------------------------------------------
-- 8. RPC: api_lagoons_preview_geometry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_lagoons_preview_geometry(p_id INTEGER)
RETURNS TABLE (
    id           INTEGER,
    centroid_lat DOUBLE PRECISION,
    centroid_lng DOUBLE PRECISION,
    geojson      TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT
        l.id,
        l.centroid_lat,
        l.centroid_lng,
        ST_AsGeoJSON(l.geom)::TEXT AS geojson
    FROM public.lagoons l
    WHERE l.id = p_id;
$$;


-- ---------------------------------------------------------------------------
-- 9. RPC: api_lagoons_filter_names
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_lagoons_filter_names(
    p_location_en      TEXT DEFAULT NULL,
    p_island_en        TEXT DEFAULT NULL,
    p_rcp2_6_inundated TEXT DEFAULT NULL,
    p_rcp8_5_inundated TEXT DEFAULT NULL
)
RETURNS TABLE (name_en TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT DISTINCT l.name_en
    FROM public.lagoons l
    WHERE
        l.name_en IS NOT NULL
        AND (p_location_en      IS NULL OR l.location_en      = p_location_en)
        AND (p_island_en        IS NULL OR l.island_en        = p_island_en)
        AND (p_rcp2_6_inundated IS NULL OR l.rcp2_6_inundated = p_rcp2_6_inundated)
        AND (p_rcp8_5_inundated IS NULL OR l.rcp8_5_inundated = p_rcp8_5_inundated)
    ORDER BY l.name_en;
$$;


-- ---------------------------------------------------------------------------
-- 10. RPC: api_lagoons_filter_locations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_lagoons_filter_locations(
    p_name_en          TEXT DEFAULT NULL,
    p_island_en        TEXT DEFAULT NULL,
    p_rcp2_6_inundated TEXT DEFAULT NULL,
    p_rcp8_5_inundated TEXT DEFAULT NULL
)
RETURNS TABLE (location_en TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT DISTINCT l.location_en
    FROM public.lagoons l
    WHERE
        l.location_en IS NOT NULL
        AND (p_name_en          IS NULL OR l.name_en          = p_name_en)
        AND (p_island_en        IS NULL OR l.island_en        = p_island_en)
        AND (p_rcp2_6_inundated IS NULL OR l.rcp2_6_inundated = p_rcp2_6_inundated)
        AND (p_rcp8_5_inundated IS NULL OR l.rcp8_5_inundated = p_rcp8_5_inundated)
    ORDER BY l.location_en;
$$;


-- ---------------------------------------------------------------------------
-- 11. RPC: api_lagoons_filter_islands
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_lagoons_filter_islands(
    p_name_en          TEXT DEFAULT NULL,
    p_location_en      TEXT DEFAULT NULL,
    p_rcp2_6_inundated TEXT DEFAULT NULL,
    p_rcp8_5_inundated TEXT DEFAULT NULL
)
RETURNS TABLE (island_en TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT DISTINCT l.island_en
    FROM public.lagoons l
    WHERE
        l.island_en IS NOT NULL
        AND (p_name_en          IS NULL OR l.name_en          = p_name_en)
        AND (p_location_en      IS NULL OR l.location_en      = p_location_en)
        AND (p_rcp2_6_inundated IS NULL OR l.rcp2_6_inundated = p_rcp2_6_inundated)
        AND (p_rcp8_5_inundated IS NULL OR l.rcp8_5_inundated = p_rcp8_5_inundated)
    ORDER BY l.island_en;
$$;


-- ---------------------------------------------------------------------------
-- 12. RPC: api_lagoons_filter_rcp26
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_lagoons_filter_rcp26(
    p_name_en          TEXT DEFAULT NULL,
    p_location_en      TEXT DEFAULT NULL,
    p_island_en        TEXT DEFAULT NULL,
    p_rcp8_5_inundated TEXT DEFAULT NULL
)
RETURNS TABLE (rcp2_6_inundated TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT DISTINCT l.rcp2_6_inundated
    FROM public.lagoons l
    WHERE
        l.rcp2_6_inundated IS NOT NULL
        AND (p_name_en          IS NULL OR l.name_en          = p_name_en)
        AND (p_location_en      IS NULL OR l.location_en      = p_location_en)
        AND (p_island_en        IS NULL OR l.island_en        = p_island_en)
        AND (p_rcp8_5_inundated IS NULL OR l.rcp8_5_inundated = p_rcp8_5_inundated)
    ORDER BY l.rcp2_6_inundated;
$$;


-- ---------------------------------------------------------------------------
-- 13. RPC: api_lagoons_filter_rcp85
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_lagoons_filter_rcp85(
    p_name_en          TEXT DEFAULT NULL,
    p_location_en      TEXT DEFAULT NULL,
    p_island_en        TEXT DEFAULT NULL,
    p_rcp2_6_inundated TEXT DEFAULT NULL
)
RETURNS TABLE (rcp8_5_inundated TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT DISTINCT l.rcp8_5_inundated
    FROM public.lagoons l
    WHERE
        l.rcp8_5_inundated IS NOT NULL
        AND (p_name_en          IS NULL OR l.name_en          = p_name_en)
        AND (p_location_en      IS NULL OR l.location_en      = p_location_en)
        AND (p_island_en        IS NULL OR l.island_en        = p_island_en)
        AND (p_rcp2_6_inundated IS NULL OR l.rcp2_6_inundated = p_rcp2_6_inundated)
    ORDER BY l.rcp8_5_inundated;
$$;


-- ---------------------------------------------------------------------------
-- 14. GRANT execute to anon role on all API functions
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.api_lagoons_count()                                       TO anon;
GRANT EXECUTE ON FUNCTION public.api_lagoons_markers(TEXT, TEXT, TEXT, TEXT, TEXT)         TO anon;
GRANT EXECUTE ON FUNCTION public.api_lagoons_polygons(TEXT, TEXT, TEXT, TEXT, TEXT)        TO anon;
GRANT EXECUTE ON FUNCTION public.api_lagoons_details(INTEGER)                              TO anon;
GRANT EXECUTE ON FUNCTION public.api_lagoons_preview_geometry(INTEGER)                      TO anon;
GRANT EXECUTE ON FUNCTION public.api_lagoons_filter_names(TEXT, TEXT, TEXT, TEXT)          TO anon;
GRANT EXECUTE ON FUNCTION public.api_lagoons_filter_locations(TEXT, TEXT, TEXT, TEXT)      TO anon;
GRANT EXECUTE ON FUNCTION public.api_lagoons_filter_islands(TEXT, TEXT, TEXT, TEXT)        TO anon;
GRANT EXECUTE ON FUNCTION public.api_lagoons_filter_rcp26(TEXT, TEXT, TEXT, TEXT)          TO anon;
GRANT EXECUTE ON FUNCTION public.api_lagoons_filter_rcp85(TEXT, TEXT, TEXT, TEXT)          TO anon;
