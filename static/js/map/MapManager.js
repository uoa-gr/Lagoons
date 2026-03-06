/**
 * MapManager - Leaflet map initialisation for Greek Lagoons
 */

import MeasurementTool from './MeasurementTool.js';

class MapManager {
    constructor(eventBus, stateManager) {
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.map = null;
        this.basemaps = {};
        this.currentBasemap = null;
        this.measurementTool = null;
    }

    init(containerId) {
        this.map = L.map(containerId, {
            center: [39.0742, 21.8243],
            zoom: 7,
            zoomControl: true,
            attributionControl: true
        });

        this._initBasemaps();
        this._initControls();
        this.stateManager.set('mapInstance', this.map);

        this.map.on('moveend zoomend', () => {
            this.stateManager.set('mapBounds', this.map.getBounds());
        });

        if (window.DEBUG_MODE) console.log('✅ MapManager: Initialized');
    }

    _initBasemaps() {
        this.basemaps = {
            'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }),
            'Topographic':   L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',  { attribution: '© OpenTopoMap contributors', maxZoom: 17 }),
            'ESRI Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri', maxZoom: 19 }),
            'CartoDB Positron': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© CartoDB', maxZoom: 19 }),
            'CartoDB Dark':     L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',  { attribution: '© CartoDB', maxZoom: 19 })
        };
        this.basemaps['ESRI Satellite'].addTo(this.map);
        this.currentBasemap = 'ESRI Satellite';
    }

    _initControls() {
        this._addBasemapPicker();

        const NorthArrow = L.Control.extend({
            options: { position: 'bottomleft' },
            onAdd() {
                const div = L.DomUtil.create('div', 'north-arrow-control');
                div.innerHTML = `<svg viewBox="0 0 40 60" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <polygon points="20,2 28,38 20,32 12,38" fill="black"/>
                    <polygon points="20,58 28,22 20,28 12,22" fill="white" stroke="black" stroke-width="1"/>
                    <text x="20" y="54" text-anchor="middle" font-size="10" font-weight="bold" fill="black">N</text>
                </svg>`;
                return div;
            }
        });
        new NorthArrow().addTo(this.map);

        if (typeof MeasurementTool !== 'undefined') {
            this.measurementTool = new MeasurementTool(this.map);
        }
    }

    _addBasemapPicker() {
        const basemapNames = Object.keys(this.basemaps);
        if (!basemapNames.length) return;

        const BasemapPickerControl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: () => {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control basemap-picker');
                const btn = L.DomUtil.create('button', 'basemap-picker-btn', container);
                btn.type = 'button';
                btn.setAttribute('aria-label', 'Select basemap');
                btn.title = 'Select basemap';
                btn.innerHTML = `
                    <svg class="basemap-picker-icon" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                         stroke-linejoin="round" aria-hidden="true" focusable="false">
                        <rect x="3" y="4" width="18" height="16" rx="1.5"/>
                        <polyline points="3 15 8 10 13 14 16 11 21 15"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                    </svg>
                `;

                const panel = L.DomUtil.create('div', 'basemap-picker-panel', container);
                panel.setAttribute('role', 'menu');
                panel.style.display = 'none';

                const closePanel = () => {
                    panel.style.display = 'none';
                    container.classList.remove('basemap-picker-open');
                };

                const openPanel = () => {
                    panel.style.display = 'block';
                    container.classList.add('basemap-picker-open');
                };

                const togglePanel = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (panel.style.display === 'none') openPanel();
                    else closePanel();
                };

                basemapNames.forEach(name => {
                    const item = L.DomUtil.create('button', 'basemap-picker-item', panel);
                    item.type = 'button';
                    item.textContent = name;
                    item.addEventListener('click', e => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.switchBasemap(name);
                        closePanel();
                    });
                });

                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);

                btn.addEventListener('click', togglePanel);

                document.addEventListener('click', e => {
                    if (!container.contains(e.target)) closePanel();
                });

                return container;
            }
        });

        this.map.addControl(new BasemapPickerControl());
    }

    switchBasemap(name) {
        if (!this.basemaps[name]) return;
        if (this.currentBasemap && this.basemaps[this.currentBasemap]) {
            this.map.removeLayer(this.basemaps[this.currentBasemap]);
        }
        this.basemaps[name].addTo(this.map);
        this.currentBasemap = name;
    }

    getMap() { return this.map; }
}

export default MapManager;
