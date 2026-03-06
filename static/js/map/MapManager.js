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
        this.basemaps['OpenStreetMap'].addTo(this.map);
    }

    _initControls() {
        const isMobile = window.innerWidth <= 768;
        L.control.layers(this.basemaps, {}, { position: isMobile ? 'bottomright' : 'topright', collapsed: true }).addTo(this.map);

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

    getMap() { return this.map; }
}

export default MapManager;
