/**
 * StatusBar - Floating status/legend bar for Greek Lagoons
 * Shows scale, legend, totals and map mode at top of map.
 */

import { formatNumber } from '../utils/helpers.js';

class StatusBar {
    constructor(eventBus, stateManager) {
        this.eventBus     = eventBus;
        this.stateManager = stateManager;
        this.container    = null;
        this.scaleControl = null;
        this.POLYGON_ZOOM_THRESHOLD = 11;

        this.elements = {
            total:         null,
            filtered:      null,
            connectionDot: null,
            scaleContainer: null,
            zoom:          null,
            polygonMode:   null
        };

        this.isOnline    = navigator.onLine;
        this.globalTotal = null;
    }

    init(map) {
        this.map = map;
        this.map.attributionControl.remove();
        this.createStatusBar();
        this.createScaleBar();
        this.setupEventListeners();
        this.setupConnectionMonitor();

        if (window.DEBUG_MODE) console.log('✅ StatusBar: Initialized');
    }

    createStatusBar() {
        const container = this.map.getContainer();

        this.container = document.createElement('div');
        this.container.className = 'map-status-bar';
        this.container.innerHTML = `
            <div class="status-bar-left-col">
                <div class="status-bar-legend">
                    <div class="legend-row">
                        <span class="legend-dot high"></span>
                        <span class="legend-text">RCP 2.6 + 8.5 inundated</span>
                    </div>
                    <div class="legend-row">
                        <span class="legend-dot medium"></span>
                        <span class="legend-text">RCP 8.5 only inundated</span>
                    </div>
                    <div class="legend-row">
                        <span class="legend-dot low"></span>
                        <span class="legend-text">No projected inundation</span>
                    </div>
                </div>
                <div class="status-bar-left">
                    <div class="status-scale" id="status-scale"></div>
                </div>
            </div>
            <div class="status-bar-right">
                <div class="status-item">
                    <span class="status-label">Total</span>
                    <span class="status-value" id="status-total">-</span>
                </div>
                <div class="status-item">
                    <span class="status-label">Showing</span>
                    <span class="status-value" id="status-filtered">-</span>
                </div>
                <div class="status-item">
                    <span class="status-label">Zoom</span>
                    <span class="status-value" id="status-zoom">-</span>
                </div>
                <div class="status-item">
                    <span class="status-label">Polygons</span>
                    <span class="status-value" id="status-polygons">OFF</span>
                </div>
                <div class="status-item status-connection">
                    <span class="status-dot online" id="status-conn-dot"></span>
                </div>
            </div>`;

        container.appendChild(this.container);

        this.elements.total         = this.container.querySelector('#status-total');
        this.elements.filtered      = this.container.querySelector('#status-filtered');
        this.elements.connectionDot = this.container.querySelector('#status-conn-dot');
        this.elements.scaleContainer = this.container.querySelector('#status-scale');
        this.elements.zoom          = this.container.querySelector('#status-zoom');
        this.elements.polygonMode   = this.container.querySelector('#status-polygons');
    }

    createScaleBar() {
        this.updateCartographicScale();
        this.map.on('moveend zoomend', () => this.updateCartographicScale());
        this.updateMapModeStats();
        this.map.on('zoomend', () => this.updateMapModeStats());
    }

    niceNum(maxVal) {
        const pow10 = Math.pow(10, Math.floor(Math.log(maxVal) / Math.LN10));
        const d = maxVal / pow10;
        return (d >= 5 ? 5 : d >= 2 ? 2 : 1) * pow10;
    }

    updateCartographicScale() {
        const el = this.elements.scaleContainer;
        if (!el || !this.map) return;

        const size = this.map.getSize();
        const maxPx = 110;
        const maxMeters = this.map.distance(
            this.map.containerPointToLatLng([0, size.y / 2]),
            this.map.containerPointToLatLng([maxPx, size.y / 2])
        );

        if (!maxMeters || !isFinite(maxMeters)) return;

        let nice;
        let unit;
        let meters;
        if (maxMeters >= 1000) {
            nice = this.niceNum(maxMeters / 1000);
            unit = 'km';
            meters = nice * 1000;
        } else {
            nice = this.niceNum(maxMeters);
            unit = 'm';
            meters = nice;
        }

        const px = Math.round(maxPx * meters / maxMeters);

        el.innerHTML = `
            <div class="carto-scale">
                <div class="carto-scale-bar" style="width:${px}px">
                    <span class="carto-seg carto-seg-b"></span>
                    <span class="carto-seg carto-seg-w"></span>
                    <span class="carto-seg carto-seg-b"></span>
                    <span class="carto-seg carto-seg-w"></span>
                </div>
                <div class="carto-scale-label">${nice}&nbsp;${unit}</div>
            </div>
        `;
    }

    updateMapModeStats() {
        if (!this.map) return;
        const zoom = this.map.getZoom();
        const polygonsOn = zoom >= this.POLYGON_ZOOM_THRESHOLD;

        if (this.elements.zoom) this.elements.zoom.textContent = formatNumber(zoom);
        if (this.elements.polygonMode) this.elements.polygonMode.textContent = polygonsOn ? 'ON' : 'OFF';
    }

    setupEventListeners() {
        this.eventBus.on('data:loaded', ({ count }) => {
            this.setFiltered(count);
            if (this.globalTotal == null) {
                this.globalTotal = count;
                this.setTotal(count);
            }
        });
    }

    setupConnectionMonitor() {
        window.addEventListener('online',  () => this.updateConnection(true));
        window.addEventListener('offline', () => this.updateConnection(false));
    }

    setTotal(count) {
        if (this.elements.total) this.elements.total.textContent = formatNumber(count);
    }

    setFiltered(count) {
        if (this.elements.filtered) this.elements.filtered.textContent = formatNumber(count);
    }

    updateConnection(isOnline) {
        if (this.elements.connectionDot) {
            this.elements.connectionDot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
        }
    }
}

export default StatusBar;
