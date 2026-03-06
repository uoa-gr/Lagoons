/**
 * PolygonManager - Lagoon polygon layer
 * Shows polygon outlines when map zoom >= POLYGON_ZOOM_THRESHOLD.
 */

const POLYGON_ZOOM_THRESHOLD = 11;

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
        return { color: '#1e3a5f', weight: 1.5, opacity: 0.8, fillColor, fillOpacity: 0.35 };
    }

    _bindPolygonInteractions(feature, layer) {
        const p = feature.properties;
        const area  = p.area_km2 != null ? `${parseFloat(p.area_km2).toFixed(2)} km²` : '-';
        const rcp26 = p.rcp2_6_inundated ? p.rcp2_6_inundated.toUpperCase() : '-';
        const rcp85 = p.rcp8_5_inundated ? p.rcp8_5_inundated.toUpperCase() : '-';

        layer.bindTooltip(`
            <div class="marker-tooltip">
                <div class="tooltip-name">${p.name_en || 'Unnamed'}</div>
                <div class="tooltip-row"><span class="tooltip-label">Location:</span> ${p.location_en || '-'}</div>
                <div class="tooltip-row"><span class="tooltip-label">Island:</span> ${p.island_en || '-'}</div>
                <div class="tooltip-row"><span class="tooltip-label">Area:</span> ${area}</div>
                <div class="tooltip-row"><span class="tooltip-label">RCP 2.6:</span> ${rcp26}</div>
                <div class="tooltip-row"><span class="tooltip-label">RCP 8.5:</span> ${rcp85}</div>
            </div>
        `, { className: 'custom-tooltip', sticky: true });

        layer.on('mouseover', () => layer.setStyle({ weight: 3, fillOpacity: 0.55 }));
        layer.on('mouseout',  () => this.polygonLayer?.resetStyle(layer));
        layer.on('click',     () => this.eventBus.emit('marker:clicked', { lagoonId: p.id }));
    }

    isVisible() { return this.polygonsVisible; }
}

export { POLYGON_ZOOM_THRESHOLD };
export default PolygonManager;
