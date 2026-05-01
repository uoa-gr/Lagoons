/**
 * PolygonManager - Lagoon polygon layer
 * Shows polygon outlines when map zoom >= POLYGON_ZOOM_THRESHOLD.
 */

import LagoonPreviewMap from './LagoonPreviewMap.js';
import { buildLagoonHoverHTML, pinTooltipInsideMap } from './LagoonHoverCard.js';

const POLYGON_ZOOM_THRESHOLD = 10;

class PolygonManager {
    constructor(map, eventBus, stateManager, dataManager) {
        this.map = map;
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.dataManager = dataManager;
        this.polygonLayer = null;
        this.polygonsVisible = false;
        this.cachedData = null;
        this.activeFilters = {};
        this.previewMap = new LagoonPreviewMap();
    }

    init() {
        this.map.on('zoomend', () => this._onZoom());
        this._onZoom();
        if (window.DEBUG_MODE) console.log('✅ PolygonManager: Initialized');
    }

    setFilters(filters) {
        this.activeFilters = filters || {};
        this.cachedData = null;
        if (this.polygonsVisible) this._updatePolygonLayer();
    }

    /**
     * Restrict rendered polygons to a set of lagoon ids (client-side).
     * Pass null/undefined to show all polygons in cache.
     */
    setVisibleIdSet(ids) {
        this.visibleIds = (ids != null) ? new Set(ids) : null;
        if (this.polygonsVisible && this.cachedData) this._renderPolygons();
    }

    _onZoom() {
        const zoom = this.map.getZoom();
        if (zoom >= POLYGON_ZOOM_THRESHOLD) {
            if (!this.polygonsVisible) { this.polygonsVisible = true; this._updatePolygonLayer(); }
        } else {
            if (this.polygonsVisible) { this.polygonsVisible = false; this._removePolygonLayer(); }
        }
    }

    async _updatePolygonLayer() {
        try {
            if (!this.cachedData) {
                this.cachedData = await this.dataManager.fetchPolygonData(this.activeFilters);
            }
            this._renderPolygons();
        } catch (error) {
            console.error('PolygonManager: Error loading polygons', error);
        }
    }

    _renderPolygons() {
        this._removePolygonLayer();
        if (!this.cachedData || this.cachedData.length === 0) return;

        const source = this.visibleIds
            ? this.cachedData.filter(r => this.visibleIds.has(r.id))
            : this.cachedData;

        const geojsonFeatures = source
            .filter(r => r.geojson)
            .map(r => ({
                type: 'Feature',
                geometry: JSON.parse(r.geojson),
                properties: {
                    id: r.id, name_en: r.name_en, location_en: r.location_en,
                    island_en: r.island_en, area_km2: r.area_km2,
                    rcp2_6_inundated: r.rcp2_6_inundated, rcp8_5_inundated: r.rcp8_5_inundated
                }
            }));

        if (geojsonFeatures.length === 0) return;

        this.polygonLayer = L.geoJSON(
            { type: 'FeatureCollection', features: geojsonFeatures },
            {
                style: feature => this._polygonStyle(feature),
                onEachFeature: (feature, layer) => this._bindPolygonInteractions(feature, layer)
            }
        );
        this.polygonLayer.addTo(this.map);

        if (window.DEBUG_MODE) console.log(`✅ PolygonManager: ${geojsonFeatures.length} polygons rendered`);
    }

    _removePolygonLayer() {
        if (this.polygonLayer) { this.map.removeLayer(this.polygonLayer); this.polygonLayer = null; }
    }

    _polygonStyle(feature) {
        const rcp85 = feature.properties?.rcp8_5_inundated?.toLowerCase();
        const rcp26 = feature.properties?.rcp2_6_inundated?.toLowerCase();
        let fillColor = '#0d9488';
        if (rcp85 === 'yes') fillColor = rcp26 === 'yes' ? '#dc2626' : '#f97316';
        return { color: '#1e3a5f', weight: 2.5, opacity: 0.9, fillColor, fillOpacity: 0.4 };
    }

    _bindPolygonInteractions(feature, layer) {
        const p = feature.properties;

        // Look up the full lagoon record so the polygon tooltip carries the
        // same fields (name_gr, vec_slr, locality treatment, …) as marker
        // tooltips. Fall back to the polygon-only properties when missing.
        const lookup = () => this._lookupLagoon(p.id) || p;

        layer.bindTooltip(() => buildLagoonHoverHTML(lookup()), {
            className: 'custom-tooltip',
            direction: 'top',
            offset:    [0, -14],
            sticky:    true
        });

        layer.on('mouseover', () => layer.setStyle({ weight: 3, fillOpacity: 0.55 }));
        layer.on('mouseout',  () => this.polygonLayer?.resetStyle(layer));

        layer.on('tooltipopen', e => {
            const center = layer.getBounds()?.getCenter?.() || null;
            this.renderTooltipPreview(e.tooltip, {
                id: p.id,
                geojson: feature.geometry,
                centroid_lat: center?.lat ?? null,
                centroid_lng: center?.lng ?? null
            });
            requestAnimationFrame(() => pinTooltipInsideMap(e.tooltip, this.map));
        });

        // Sticky tooltips re-position on every mousemove → re-clamp each time.
        let pinPending = false;
        layer.on('mousemove', () => {
            const tooltip = layer.getTooltip?.();
            if (!tooltip || pinPending) return;
            pinPending = true;
            requestAnimationFrame(() => {
                pinPending = false;
                pinTooltipInsideMap(tooltip, this.map);
            });
        });

        layer.on('tooltipclose', e => this.destroyTooltipPreview(e.tooltip));

        layer.on('click', () => {
            const center = layer.getBounds()?.getCenter?.() || null;
            this.eventBus.emit('marker:clicked', {
                lagoonId: p.id,
                previewGeojson: feature.geometry,
                centroidLat: center?.lat ?? null,
                centroidLng: center?.lng ?? null
            });
        });
    }

    _lookupLagoon(id) {
        const data = this.stateManager?.get?.('currentData');
        if (!Array.isArray(data)) return null;
        return data.find(r => r && r.id === id) || null;
    }

    renderTooltipPreview(tooltip, previewData) {
        const tooltipEl = tooltip?.getElement?.();
        const previewContainer = tooltipEl?.querySelector('[data-tooltip-preview-map]');
        if (!previewContainer) return;
        this.previewMap.render(previewContainer, previewData);
    }

    destroyTooltipPreview(tooltip) {
        const tooltipEl = tooltip?.getElement?.();
        const previewContainer = tooltipEl?.querySelector('[data-tooltip-preview-map]');
        if (previewContainer) this.previewMap.destroy(previewContainer);
    }

    isVisible() { return this.polygonsVisible; }
}

export { POLYGON_ZOOM_THRESHOLD };
export default PolygonManager;
