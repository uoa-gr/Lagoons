/**
 * MarkerManager - Centroid dot markers for Greek Lagoons
 */

import LagoonPreviewMap from './LagoonPreviewMap.js';
import { escapeHtml } from '../utils/helpers.js';

class MarkerManager {
    constructor(map, eventBus, stateManager, dataManager = null) {
        this.map = map;
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.dataManager = dataManager;
        this.clusterGroup = null;
        this.markers = [];
        this.previewMap = new LagoonPreviewMap();
        this.tooltipCloseTimers = new Map();
        this.geometryCache = new Map();
    }

    init() {
        const COLORS = {
            high:   { fill: '#dc2626', ring: '#f87171' },
            medium: { fill: '#f97316', ring: '#fdba74' },
            low:    { fill: '#0d9488', ring: '#5eead4' }
        };

        this.clusterGroup = L.markerClusterGroup({
            maxClusterRadius: 60,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: true,
            iconCreateFunction(cluster) {
                const children = cluster.getAllChildMarkers();
                const count = children.length;
                let size = 'small';
                if (count >= 100) size = 'large';
                else if (count >= 10) size = 'medium';

                let high = 0, med = 0, low = 0;
                children.forEach(m => {
                    const cat = m._rcpCategory;
                    if (cat === 'high') high++;
                    else if (cat === 'medium') med++;
                    else low++;
                });

                const total = high + med + low;
                const pHigh = (high / total) * 360;
                const pMed  = (med / total) * 360;

                let fillBg, ringBg;
                if (high === total) {
                    fillBg = COLORS.high.fill;
                    ringBg = COLORS.high.ring;
                } else if (med === total) {
                    fillBg = COLORS.medium.fill;
                    ringBg = COLORS.medium.ring;
                } else if (low === total) {
                    fillBg = COLORS.low.fill;
                    ringBg = COLORS.low.ring;
                } else {
                    const s1 = pHigh;
                    const s2 = s1 + pMed;
                    fillBg = `conic-gradient(${COLORS.high.fill} 0deg ${s1}deg, ${COLORS.medium.fill} ${s1}deg ${s2}deg, ${COLORS.low.fill} ${s2}deg 360deg)`;
                    ringBg = `conic-gradient(${COLORS.high.ring} 0deg ${s1}deg, ${COLORS.medium.ring} ${s1}deg ${s2}deg, ${COLORS.low.ring} ${s2}deg 360deg)`;
                }

                return L.divIcon({
                    html: `<div class="cluster-icon cluster-${size}" style="background:${ringBg}"><div class="cluster-inner" style="background:${fillBg}"><span>${count}</span></div></div>`,
                    className: '',
                    iconSize: L.point(40, 40)
                });
            }
        });
        this.map.addLayer(this.clusterGroup);

        this._loadGeometries();

        if (window.DEBUG_MODE) console.log('✅ MarkerManager: Initialized');
    }

    updateMarkers(data) {
        this.clusterGroup.clearLayers();
        this.markers = [];
        if (!data || data.length === 0) { this.eventBus.emit('markers:updated', { count: 0 }); return; }
        data.forEach(lagoon => {
            const lat = lagoon.centroid_lat;
            const lng = lagoon.centroid_lng;
            if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return;
            const marker = this.createMarker(lagoon);
            this.markers.push(marker);
            this.clusterGroup.addLayer(marker);
        });
        this.eventBus.emit('markers:updated', { count: this.markers.length });
    }

    createMarker(lagoon) {
        const rcp85 = lagoon.rcp8_5_inundated?.toLowerCase();
        const rcp26 = lagoon.rcp2_6_inundated?.toLowerCase();
        let fill = '#0d9488';
        let border = '#5eead4';
        if (rcp85 === 'yes') {
            if (rcp26 === 'yes') { fill = '#dc2626'; border = '#f87171'; }
            else                 { fill = '#f97316'; border = '#fdba74'; }
        }

        const icon = L.divIcon({
            className: '',
            html: `<div class="lagoon-marker" style="background:${fill};border-color:${border}"></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9]
        });
        const marker = L.marker([lagoon.centroid_lat, lagoon.centroid_lng], { icon });

        // Store category so cluster icons can read it
        if (rcp85 === 'yes' && rcp26 === 'yes') marker._rcpCategory = 'high';
        else if (rcp85 === 'yes')                marker._rcpCategory = 'medium';
        else                                     marker._rcpCategory = 'low';

        marker.bindTooltip(this.buildTooltipHTML(lagoon), {
            className: 'custom-tooltip',
            direction: 'top',
            offset: [0, -14],
            interactive: true
        });

        marker.on('mouseover', () => {
            this._clearCloseTimer(marker);
            if (!marker.isTooltipOpen()) marker.openTooltip();
        });

        marker.on('mouseout', () => {
            this._scheduleClose(marker, 320);
        });

        marker.on('tooltipopen', e => {
            this._bindTooltipHover(marker);
            this.renderTooltipPreview(e.tooltip, lagoon);
        });

        marker.on('tooltipclose', e => {
            this.destroyTooltipPreview(e.tooltip);
        });

        marker.on('click', () => {
            this.eventBus.emit('marker:clicked', {
                lagoonId: lagoon.id,
                previewGeojson: this.geometryCache.get(lagoon.id) || null,
                centroidLat: lagoon.centroid_lat,
                centroidLng: lagoon.centroid_lng
            });
        });

        return marker;
    }

    buildTooltipHTML(lagoon) {
        const rcp26 = lagoon.rcp2_6_inundated ? lagoon.rcp2_6_inundated.toUpperCase() : '-';
        const rcp85 = lagoon.rcp8_5_inundated ? lagoon.rcp8_5_inundated.toUpperCase() : '-';
        const area  = lagoon.area_km2 != null ? `${parseFloat(lagoon.area_km2).toFixed(2)} km²` : '-';

        return `
            <div class="lagoon-hover-card">
                <div class="lagoon-hover-preview">
                    <div class="lagoon-preview-map" data-tooltip-preview-map></div>
                </div>
                <div class="lagoon-hover-body">
                    <div class="lagoon-hover-name">${escapeHtml(lagoon.name_en || 'Unnamed')}</div>
                    <div class="lagoon-hover-row"><span class="lagoon-hover-label">Location</span><span class="lagoon-hover-value">${escapeHtml(lagoon.location_en || '-')}</span></div>
                    <div class="lagoon-hover-row"><span class="lagoon-hover-label">Island</span><span class="lagoon-hover-value">${escapeHtml(lagoon.island_en || '-')}</span></div>
                    <div class="lagoon-hover-row"><span class="lagoon-hover-label">Area</span><span class="lagoon-hover-value">${escapeHtml(area)}</span></div>
                    <div class="lagoon-hover-row"><span class="lagoon-hover-label">RCP 2.6</span><span class="lagoon-hover-value">${escapeHtml(rcp26)}</span></div>
                    <div class="lagoon-hover-row"><span class="lagoon-hover-label">RCP 8.5</span><span class="lagoon-hover-value">${escapeHtml(rcp85)}</span></div>
                </div>
            </div>
        `;
    }

    renderTooltipPreview(tooltip, lagoon) {
        const tooltipEl = tooltip?.getElement?.();
        const previewContainer = tooltipEl?.querySelector('[data-tooltip-preview-map]');
        if (!previewContainer) return;

        this.previewMap.render(previewContainer, {
            id: lagoon.id,
            geojson: this.geometryCache.get(lagoon.id) || null,
            centroid_lat: lagoon.centroid_lat,
            centroid_lng: lagoon.centroid_lng
        });
    }

    destroyTooltipPreview(tooltip) {
        const tooltipEl = tooltip?.getElement?.();
        const previewContainer = tooltipEl?.querySelector('[data-tooltip-preview-map]');
        if (previewContainer) this.previewMap.destroy(previewContainer);
    }

    async _loadGeometries() {
        if (!this.dataManager?.fetchPolygonData) return;
        try {
            const polygonData = await this.dataManager.fetchPolygonData({});
            if (polygonData) {
                polygonData.forEach(r => {
                    if (r.geojson) this.geometryCache.set(r.id, r.geojson);
                });
            }
        } catch (e) {
            if (window.DEBUG_MODE) console.warn('MarkerManager: Failed to load geometries', e);
        }
    }

    _bindTooltipHover(marker) {
        const tooltipEl = marker?.getTooltip?.()?.getElement?.();
        if (!tooltipEl || tooltipEl.dataset.hoverBound === '1') return;
        tooltipEl.dataset.hoverBound = '1';
        tooltipEl.addEventListener('mouseenter', () => this._clearCloseTimer(marker));
        tooltipEl.addEventListener('mouseleave', () => this._scheduleClose(marker, 180));
    }

    _scheduleClose(marker, delay) {
        this._clearCloseTimer(marker);
        const id = setTimeout(() => { marker.closeTooltip(); this.tooltipCloseTimers.delete(marker); }, delay);
        this.tooltipCloseTimers.set(marker, id);
    }

    _clearCloseTimer(marker) {
        const id = this.tooltipCloseTimers.get(marker);
        if (id) { clearTimeout(id); this.tooltipCloseTimers.delete(marker); }
    }

    getMarkers()  { return this.markers; }

    clearMarkers() {
        this.clusterGroup?.clearLayers();
        this.markers = [];
    }
}

export default MarkerManager;
