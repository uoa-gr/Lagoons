/**
 * StatusBar - Bottom status bar for Greek Lagoons
 * Shows total / showing counts and connection status.
 */

import { formatNumber } from '../utils/helpers.js';

class StatusBar {
    constructor(eventBus, stateManager) {
        this.eventBus     = eventBus;
        this.stateManager = stateManager;
        this.container    = null;
        this.scaleControl = null;

        this.elements = {
            total:         null,
            filtered:      null,
            connectionDot: null,
            scaleContainer: null
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
            <div class="status-bar-left">
                <div class="status-scale" id="status-scale"></div>
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
                <div class="status-item status-connection">
                    <span class="status-dot online" id="status-conn-dot"></span>
                </div>
            </div>`;

        container.appendChild(this.container);

        this.elements.total         = this.container.querySelector('#status-total');
        this.elements.filtered      = this.container.querySelector('#status-filtered');
        this.elements.connectionDot = this.container.querySelector('#status-conn-dot');
        this.elements.scaleContainer = this.container.querySelector('#status-scale');
    }

    createScaleBar() {
        this.scaleControl = L.control.scale({
            position: 'bottomleft',
            metric: true,
            imperial: false,
            maxWidth: 100
        });
        this.scaleControl.addTo(this.map);

        const scaleEl = document.querySelector('.leaflet-control-scale');
        if (scaleEl && this.elements.scaleContainer) {
            this.elements.scaleContainer.appendChild(scaleEl);
        }
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
