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
        this.clusterGroup = L.markerClusterGroup({
            maxClusterRadius: 60,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: true,
            iconCreateFunction(cluster) {
                const children = cluster.getAllChildMarkers();
                const count = children.length;

                let high = 0, med = 0, low = 0;
                children.forEach(m => {
                    const cat = m._rcpCategory;
                    if (cat === 'high') high++;
                    else if (cat === 'medium') med++;
                    else low++;
                });

                const sz = count >= 100 ? 44 : count >= 10 ? 40 : 36;
                const badges = [];
                if (high) badges.push(`<span class="cluster-badge badge-high">${high}</span>`);
                if (med)  badges.push(`<span class="cluster-badge badge-medium">${med}</span>`);
                if (low)  badges.push(`<span class="cluster-badge badge-low">${low}</span>`);

                return L.divIcon({
                    html: `<div class="cluster-icon" style="width:${sz}px;height:${sz}px;">${count}${badges.join('')}</div>`,
                    className: 'minimal-cluster',
                    iconSize: L.point(sz, sz),
                    iconAnchor: L.point(sz / 2, sz / 2)
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
        const fmtNum = (v, digits, unit) => {
            if (v == null || v === '') return '—';
            const n = parseFloat(v);
            return Number.isFinite(n) ? `${n.toFixed(digits)} ${unit}` : '—';
        };

        const area = fmtNum(lagoon.area_km2, 2, 'km²');

        // Pick VLM-corrected when available, geocentric otherwise; tag which one is shown.
        // (vec_slr === 0 is a sentinel for "no local VLM" — already normalised to null upstream.)
        const slrParts = (vecVal, geoVal) => {
            const vec = parseFloat(vecVal);
            const geo = parseFloat(geoVal);
            const useVlm = Number.isFinite(vec) && Math.abs(vec) > 1e-9;
            const v = useVlm ? vec : geo;
            const tag = useVlm ? 'VLM' : 'geo';
            return Number.isFinite(v)
                ? { value: `${parseFloat(v).toFixed(2)} m`, tag }
                : { value: '—', tag: null };
        };
        const slr_26 = slrParts(lagoon.rcp2_6_vec_slr, lagoon.rcp2_6_slr);
        const slr_85 = slrParts(lagoon.rcp8_5_vec_slr, lagoon.rcp8_5_slr);
        const slrTagHtml = (t) => t.tag
            ? `<span class="lagoon-hover-basis-tag is-${t.tag}">${t.tag}</span>`
            : '<span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>';

        const loc    = (lagoon.location_en || '').trim();
        const island = (lagoon.island_en   || '').trim();
        const sameWord = loc && island && loc.toLowerCase() === island.toLowerCase();
        const localityHtml = (loc || island)
            ? `<div class="lagoon-hover-locality">
                 <svg class="lagoon-hover-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                     <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                     <circle cx="12" cy="10" r="3"/>
                 </svg>
                 ${loc ? `<span class="lagoon-hover-loc-main">${escapeHtml(loc)}</span>` : ''}
                 ${island && (!loc || !sameWord) ? `${loc ? `<span class="lagoon-hover-loc-dot" aria-hidden="true">·</span>` : ''}<span class="lagoon-hover-loc-island">${escapeHtml(island)}</span>` : ''}
               </div>`
            : '';

        return `
            <div class="lagoon-hover-card">
                <div class="lagoon-hover-preview">
                    <div class="lagoon-preview-map" data-tooltip-preview-map></div>
                </div>
                <div class="lagoon-hover-body">
                    <span class="lagoon-hover-eyebrow">Coastal lagoon</span>
                    <h3 class="lagoon-hover-name">
                        <span class="lagoon-hover-name-en">${escapeHtml(lagoon.name_en || 'Unnamed')}</span>
                        ${lagoon.name_gr ? `
                            <span class="lagoon-hover-name-sep" aria-hidden="true">/</span>
                            <span class="lagoon-hover-name-gr">${escapeHtml(lagoon.name_gr)}</span>
                        ` : ''}
                    </h3>
                    ${localityHtml}
                    <div class="lagoon-hover-stats">
                        <div class="lagoon-hover-stat">
                            <span class="lagoon-hover-stat-label">Area</span>
                            <span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>
                            <span class="lagoon-hover-stat-value">${escapeHtml(area)}</span>
                        </div>
                        <div class="lagoon-hover-stat">
                            <span class="lagoon-hover-stat-label">SSP1-2.6 SLR</span>
                            ${slrTagHtml(slr_26)}
                            <span class="lagoon-hover-stat-value">${escapeHtml(slr_26.value)}</span>
                        </div>
                        <div class="lagoon-hover-stat">
                            <span class="lagoon-hover-stat-label">SSP5-8.5 SLR</span>
                            ${slrTagHtml(slr_85)}
                            <span class="lagoon-hover-stat-value">${escapeHtml(slr_85.value)}</span>
                        </div>
                    </div>
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
