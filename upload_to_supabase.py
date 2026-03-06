#!/usr/bin/env python3
"""
Greek Lagoons - Upload shapefile to Supabase
Reads Greek_lagoons_20250727.shp, reprojects to WGS84, computes centroids,
and uploads all records to the lagoons table via the Supabase REST API.

Usage:
    pip install geopandas requests shapely
    python upload_to_supabase.py

Set SUPABASE_URL and SUPABASE_SERVICE_KEY below (never commit real keys).
"""

import json
import math
import sys
import time

import geopandas as gpd
import requests
from shapely.geometry import mapping

# ---------------------------------------------------------------------------
# Configuration – replace with your actual values before running
# ---------------------------------------------------------------------------
SUPABASE_URL = "https://gemokuqzdurkkgkyseix.supabase.co"          # e.g. https://xxxx.supabase.co
SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlbW9rdXF6ZHVya2tna3lzZWl4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzU1MTkzNiwiZXhwIjoyMDczMTI3OTM2fQ.q6N_aZwi3VNSAXokb4oOaGU3wuPA9SZqV38l8trKBlY"   # service_role key (never commit!)

SHP_PATH = "data/Greek_lagoons_20250727.shp"
TABLE    = "lagoons"
BATCH    = 50   # records per POST request
# ---------------------------------------------------------------------------


HEADERS = {
    "apikey":        SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "resolution=merge-duplicates",
}


def clean(val):
    """Normalise a value: NaN / empty → None."""
    if val is None:
        return None
    if isinstance(val, float) and math.isnan(val):
        return None
    s = str(val).strip()
    if s.lower() in ("", "nan", "none", "null"):
        return None
    return s


def clean_float(val):
    if val is None:
        return None
    if isinstance(val, float) and math.isnan(val):
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def geom_to_wkt(geom):
    """Return WKT string for the geometry (already reprojected to WGS84)."""
    if geom is None or geom.is_empty:
        return None
    return geom.wkt


def row_to_record(row):
    """Map a GeoDataFrame row to a dict matching the lagoons table schema."""
    geom = row.geometry
    centroid = geom.centroid if geom is not None else None

    return {
        "name_en":   clean(row.get("Name_EN")),
        "name_gr":   clean(row.get("Name")),
        "location_en": clean(row.get("Location_E")),
        "island_en":   clean(row.get("Island_EN")),
        "length_m":    clean_float(row.get("Lenght")),
        "width_m":     clean_float(row.get("Width")),
        "height_m":    clean_float(row.get("Height")),
        "perimeter_km2": clean_float(row.get("Perimeter")),
        "area_km2":    clean_float(row.get("Area")),
        "rcp2_6_slr":     clean_float(row.get("RCP2_6")),
        "rcp8_5_slr":     clean_float(row.get("RCP8_5")),
        "rcp2_6_vec_slr": clean_float(row.get("RCP2_6_Vec")),
        "rcp8_5_vec_slr": clean_float(row.get("RCP8_5_Vec")),
        "rcp2_6_inundated":     clean(row.get("RCP2_6_Inu")),
        "rcp8_5_inundated":     clean(row.get("RCP8_5_Inu")),
        "rcp2_6_vec_inundated": clean(row.get("RCP2_6V_In")),
        "rcp8_5_vec_inundated": clean(row.get("RCP8_5V_In")),
        "data_quality": clean(row.get("vecchio")),
        "geom": f"SRID=4326;{geom_to_wkt(geom)}" if geom else None,
        "centroid_lat": centroid.y if centroid else None,
        "centroid_lng": centroid.x if centroid else None,
    }


def upload_batch(records):
    url = f"{SUPABASE_URL}/rest/v1/{TABLE}"
    resp = requests.post(url, headers=HEADERS, data=json.dumps(records), timeout=30)
    if resp.status_code not in (200, 201):
        print(f"  ✗ HTTP {resp.status_code}: {resp.text[:300]}")
        return False
    return True


def main():
    print(f"Reading shapefile: {SHP_PATH}")
    gdf = gpd.read_file(SHP_PATH)
    print(f"  Loaded {len(gdf)} features (CRS: {gdf.crs})")

    if gdf.crs and gdf.crs.to_epsg() != 4326:
        print("  Reprojecting to EPSG:4326 …")
        gdf = gdf.to_crs(epsg=4326)

    records = [row_to_record(row) for _, row in gdf.iterrows()]
    print(f"  Prepared {len(records)} records")

    total   = len(records)
    success = 0
    for i in range(0, total, BATCH):
        batch = records[i : i + BATCH]
        ok = upload_batch(batch)
        if ok:
            success += len(batch)
            print(f"  ✓ Uploaded {min(i + BATCH, total)}/{total}")
        else:
            print(f"  ✗ Batch {i}–{i+BATCH} failed — aborting")
            sys.exit(1)
        time.sleep(0.2)

    print(f"\nDone. {success}/{total} records uploaded to '{TABLE}'.")


if __name__ == "__main__":
    main()
