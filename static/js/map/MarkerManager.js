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
        this.activeTooltipRequests = new Map();
        this.tooltipCloseTimers = new Map();
        this.geometryCache = new Map();
        this.geometryPending = new Map();
    }

    init() {
        this.clusterGroup = L.markerClusterGroup({
            maxClusterRadius: 60,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: true,
            iconCreateFunction(cluster) {
                const count = cluster.getChildCount();
                let size = 'small';
                if (count >= 100) size = 'large';
                else if (count >= 10) size = 'medium';
                return L.divIcon({
                    html: `<div class="cluster-icon cluster-${size}"><span>${count}</span></div>`,
                    className: '',
                    iconSize: L.point(40, 40)
                });
            }
        });
        this.map.addLayer(this.clusterGroup);
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
        let border = '#99f6e4';
        if (rcp85 === 'yes') {
            if (rcp26 === 'yes') { fill = '#dc2626'; border = '#fecaca'; }
            else                 { fill = '#f97316'; border = '#fed7aa'; }
        }

        const icon = L.divIcon({
            className: '',
            html: `<div class="lagoon-marker" style="background:${fill};border-color:${border}"></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9]
        });
        const marker = L.marker([lagoon.centroid_lat, lagoon.centroid_lng], { icon });

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

        marker.on('tooltipopen', async e => {
            this._bindTooltipHover(marker);
            await this.renderTooltipPreview(e.tooltip, lagoon);
        });

        marker.on('tooltipclose', e => {
            this.activeTooltipRequests.delete(lagoon.id);
            this.destroyTooltipPreview(e.tooltip);
        });

        marker.on('click', async () => {
            const geometry = await this._fetchGeometry(lagoon.id);
            this.eventBus.emit('marker:clicked', {
                lagoonId: lagoon.id,
                previewGeojson: geometry?.geojson || null,
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

    async renderTooltipPreview(tooltip, lagoon) {
        const tooltipEl = tooltip?.getElement?.();
        const previewContainer = tooltipEl?.querySelector('[data-tooltip-preview-map]');
        if (!previewContainer) return;

        // First pass: render with centroid immediately (same as polygon hover fallback)
        this.previewMap.render(previewContainer, {
            id: lagoon.id,
            centroid_lat: lagoon.centroid_lat,
            centroid_lng: lagoon.centroid_lng
        });

        // Second pass: fetch geometry and re-render with polygon
        const geometry = await this._fetchGeometry(lagoon.id);
        if (!geometry?.geojson) return;
        if (!document.body.contains(previewContainer)) return;

        this.previewMap.render(previewContainer, {
            id: lagoon.id,
            geojson: geometry.geojson,
            centroid_lat: geometry.centroid_lat ?? lagoon.centroid_lat,
            centroid_lng: geometry.centroid_lng ?? lagoon.centroid_lng
        });
    }

    destroyTooltipPreview(tooltip) {
        const tooltipEl = tooltip?.getElement?.();
        const previewContainer = tooltipEl?.querySelector('[data-tooltip-preview-map]');
        if (previewContainer) this.previewMap.destroy(previewContainer);
    }

    async _fetchGeometry(lagoonId) {
        if (this.geometryCache.has(lagoonId)) return this.geometryCache.get(lagoonId);
        if (this.geometryPending.has(lagoonId)) return this.geometryPending.get(lagoonId);

        if (!this.dataManager?.fetchLagoonGeometryById) return null;

        const promise = this.dataManager.fetchLagoonGeometryById(lagoonId)
            .then(geometry => {
                if (geometry) this.geometryCache.set(lagoonId, geometry);
                this.geometryPending.delete(lagoonId);
                return geometry || null;
            })
            .catch(error => {
                this.geometryPending.delete(lagoonId);
                if (window.DEBUG_MODE) {
                    console.warn(`MarkerManager: Geometry fetch failed for lagoon ${lagoonId}`, error);
                }
                return null;
            });

        this.geometryPending.set(lagoonId, promise);
        return promise;
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
        this.activeTooltipRequests.clear();
        this.geometryCache.clear();
        this.geometryPending.clear();
    }
}

export default MarkerManager;
