/**
 * PolygonManager - Lagoon polygon layer
 * Shows polygon outlines when map zoom >= POLYGON_ZOOM_THRESHOLD.
 */

import LagoonPreviewMap from './LagoonPreviewMap.js';
import { escapeHtml } from '../utils/helpers.js';

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
            this._removePolygonLayer();
            if (!this.cachedData || this.cachedData.length === 0) return;

            const geojsonFeatures = this.cachedData
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
        } catch (error) {
            console.error('PolygonManager: Error loading polygons', error);
        }
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
        layer.bindTooltip(this.buildTooltipHTML(p), { className: 'custom-tooltip', sticky: true });

        layer.on('mouseover', () => layer.setStyle({ weight: 3, fillOpacity: 0.55 }));
        layer.on('mouseout',  () => this.polygonLayer?.resetStyle(layer));

        layer.on('tooltipopen', e => {
            const center = layer.getBounds()?.getCenter?.() || null;
            const previewData = {
                id: p.id,
                geojson: feature.geometry,
                centroid_lat: center?.lat ?? null,
                centroid_lng: center?.lng ?? null
            };
            this.renderTooltipPreview(e.tooltip, previewData);
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

    buildTooltipHTML(properties) {
        const area  = properties.area_km2 != null ? `${parseFloat(properties.area_km2).toFixed(2)} km²` : '-';
        const rcp26 = properties.rcp2_6_inundated ? properties.rcp2_6_inundated.toUpperCase() : '-';
        const rcp85 = properties.rcp8_5_inundated ? properties.rcp8_5_inundated.toUpperCase() : '-';

        return `
            <div class="lagoon-hover-card">
                <div class="lagoon-hover-preview">
                    <div class="lagoon-preview-map" data-tooltip-preview-map></div>
                </div>
                <div class="lagoon-hover-body">
                    <div class="lagoon-hover-name">${escapeHtml(properties.name_en || 'Unnamed')}</div>
                    <div class="lagoon-hover-row"><span class="lagoon-hover-label">Location</span><span class="lagoon-hover-value">${escapeHtml(properties.location_en || '-')}</span></div>
                    <div class="lagoon-hover-row"><span class="lagoon-hover-label">Island</span><span class="lagoon-hover-value">${escapeHtml(properties.island_en || '-')}</span></div>
                    <div class="lagoon-hover-row"><span class="lagoon-hover-label">Area</span><span class="lagoon-hover-value">${escapeHtml(area)}</span></div>
                    <div class="lagoon-hover-row"><span class="lagoon-hover-label">RCP 2.6</span><span class="lagoon-hover-value">${escapeHtml(rcp26)}</span></div>
                    <div class="lagoon-hover-row"><span class="lagoon-hover-label">RCP 8.5</span><span class="lagoon-hover-value">${escapeHtml(rcp85)}</span></div>
                </div>
            </div>
        `;
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
