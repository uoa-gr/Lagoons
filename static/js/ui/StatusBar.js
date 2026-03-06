/**
 * StatusBar - Floating map stats bar for Greek Lagoons
 * Shows totals and map mode, while scale stays as a native bottom-left control.
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
        this.elements.zoom          = this.container.querySelector('#status-zoom');
        this.elements.polygonMode   = this.container.querySelector('#status-polygons');
    }

    createScaleBar() {
        this.scaleControl = L.control.scale({
            position: 'bottomleft',
            metric: true,
            imperial: false,
            maxWidth: 120
        });
        this.scaleControl.addTo(this.map);

        this.updateMapModeStats();
        this.map.on('zoomend', () => this.updateMapModeStats());
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
