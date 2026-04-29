/**
 * Greek Lagoons Web Map - Main Entry Point
 * Orchestrates all application modules.
 */

import EventBus       from './core/EventBus.js';
import StateManager   from './core/StateManager.js';
import CacheManager   from './core/CacheManager.js';
import DataManager    from './data/DataManager.js';
import StatsManager   from './data/StatsManager.js';
import MapManager     from './map/MapManager.js';
import MarkerManager  from './map/MarkerManager.js';
import PolygonManager from './map/PolygonManager.js';
import ModalManager   from './ui/ModalManager.js';
import UIController   from './ui/UIController.js';
import FilterManager  from './ui/FilterManager.js';
import FilterDisplay  from './ui/FilterDisplay.js';
import GlobalSearch   from './ui/GlobalSearch.js';
import QueryBuilder   from './ui/QueryBuilder.js';
import StatisticsPanel from './ui/StatisticsPanel.js';
import NumericRangeFilters from './ui/NumericRangeFilters.js';
import FilterByChart  from './ui/FilterByChart.js';
import MobileControls from './ui/MobileControls.js';
import StatusBar      from './ui/StatusBar.js';
import EmailHelper    from './utils/EmailHelper.js';
import DropdownLimiter from './utils/DropdownLimiter.js';

// VLM-corrected SLR uses 0 as a "no local VLM" sentinel — convert to null so stats / charts skip it
function normaliseVlmSentinels(r) {
    if (!r) return r;
    const eps = 1e-9;
    const fix = v => (v != null && Math.abs(parseFloat(v)) < eps ? null : v);
    return {
        ...r,
        rcp2_6_vec_slr: fix(r.rcp2_6_vec_slr),
        rcp8_5_vec_slr: fix(r.rcp8_5_vec_slr)
    };
}

// Apply numeric range filters client-side. Records with null in a filtered field
// pass through (so VLM-missing rows aren't dropped just because the user touched a SLR slider).
function applyNumericRanges(records, ranges) {
    const fields = Object.keys(ranges || {});
    if (!fields.length) return records;
    return records.filter(r => {
        for (const k of fields) {
            const v = parseFloat(r?.[k]);
            if (!Number.isFinite(v)) continue;
            const { min, max } = ranges[k];
            if (v < min || v > max) return false;
        }
        return true;
    });
}

class LagoonMapApplication {
    constructor() {
        this.eventBus     = new EventBus();
        this.cacheManager = new CacheManager();
        this.stateManager = new StateManager(this.eventBus);

        this.dataManager    = null;
        this.statsManager   = null;
        this.mapManager     = null;
        this.markerManager  = null;
        this.polygonManager = null;
        this.modalManager   = null;
        this.uiController   = null;
        this.filterManager  = null;
        this.filterDisplay  = null;
        this.globalSearch   = null;
        this.queryBuilder   = null;
        this.statisticsPanel = null;
        this.numericRangeFilters = null;
        this.filterByChart = null;
        this.mobileControls = null;
        this.statusBar      = null;
        this.emailHelper    = null;
        this.dropdownLimiter = null;
    }

    async init() {
        try {
            if (window.DEBUG_MODE) console.log('🚀 LagoonMapApplication: Starting…');

            // Instantiate
            this.dataManager    = new DataManager(this.eventBus, this.cacheManager, this.stateManager);
            this.statsManager   = new StatsManager(this.eventBus, this.dataManager);
            this.mapManager     = new MapManager(this.eventBus, this.stateManager);
            this.modalManager   = new ModalManager(this.eventBus, this.cacheManager);
            this.uiController   = new UIController(this.eventBus, this.stateManager);
            this.filterManager  = new FilterManager(this.eventBus, this.stateManager, this.dataManager);
            this.filterDisplay  = new FilterDisplay(this.eventBus, this.stateManager);
            this.globalSearch   = new GlobalSearch(this.eventBus, this.stateManager, this.filterManager);
            this.queryBuilder   = new QueryBuilder(this.eventBus, this.stateManager, this.dataManager);
            this.statisticsPanel = new StatisticsPanel(this.eventBus, this.stateManager, this.mapManager);
            this.numericRangeFilters = new NumericRangeFilters(this.eventBus, this.stateManager);
            this.filterByChart  = new FilterByChart(this.eventBus, this.stateManager, this.dataManager,
                                                    this.filterManager, this.numericRangeFilters);
            this.mobileControls = new MobileControls(this.eventBus, this.stateManager);
            this.emailHelper    = new EmailHelper();
            this.dropdownLimiter = new DropdownLimiter();

            // Map
            this.mapManager.init('map');
            const map = this.mapManager.getMap();

            // Marker cluster layer
            this.markerManager = new MarkerManager(map, this.eventBus, this.stateManager, this.dataManager);
            this.markerManager.init();

            // Polygon layer (zoom-triggered)
            this.polygonManager = new PolygonManager(map, this.eventBus, this.stateManager, this.dataManager);
            this.polygonManager.init();

            // Status bar (attaches to map container)
            this.statusBar = new StatusBar(this.eventBus, this.stateManager);
            this.statusBar.init(map);

            // UI modules
            this.modalManager.init();
            this.uiController.init();
            this.filterManager.init();
            this.filterDisplay.init();
            this.globalSearch.init();
            this.queryBuilder.init();
            this.statisticsPanel.init();
            this.numericRangeFilters.init();
            this.filterByChart.init();
            this.statsManager.init();
            this.mobileControls.init();
            this.dropdownLimiter.init();

            this.setupEventHandlers();
            this.setupModalButtonHandlers();

            // Connect to Supabase
            const connected = await this.dataManager.init();
            if (!connected) {
                this.uiController.showError('Failed to connect to database. Check your configuration.');
                this.filterManager.disableFilters();
                return;
            }

            await this.loadInitialData();

            if (window.DEBUG_MODE) console.log('✅ LagoonMapApplication: Ready');
            window.app = this;

        } catch (err) {
            console.error('❌ LagoonMapApplication init failed', err);
            this.uiController?.showError('Application failed to initialize. Please refresh.');
        }
    }

    // ── Event wiring ─────────────────────────────────────────────────────────

    setupEventHandlers() {
        // Mapping from FilterManager's filterKeys → data column on each record
        const FK_TO_DATAKEY = {
            name: 'name_en', location: 'location_en', island: 'island_en',
            rcp2_6_inundated: 'rcp2_6_inundated', rcp8_5_inundated: 'rcp8_5_inundated'
        };

        /**
         * The single client-side filter pipeline.
         * Reads multi-select state from FilterByChart, ranges from
         * NumericRangeFilters, and the SQL filter from stateManager. Applies
         * everything to the cached unfiltered records and updates the map,
         * statistics, and filter-option counts.
         */
        const applyClient = () => {
            const fbc = this.filterByChart;
            if (!fbc) return;
            const all = fbc.allRecords;
            if (!all || !all.length) return;

            let data = all;
            const sel = fbc.getSelections();
            for (const [filterKey, set] of Object.entries(sel)) {
                if (!set || set.size === 0) continue;
                const dataField = FK_TO_DATAKEY[filterKey];
                if (!dataField) continue;
                data = data.filter(r => set.has(String(r?.[dataField])));
            }

            const ranges = this.numericRangeFilters?.getActiveRanges?.() || {};
            data = applyNumericRanges(data, ranges);

            const sql = this.stateManager.get('activeSqlFilter');
            if (sql && sql.length) data = this.queryBuilder.filterData(data, sql);

            this.stateManager.set('currentData', data);
            this.markerManager.updateMarkers(data);
            // Sync polygon layer (visible at high zoom) with the filtered set.
            this.polygonManager?.setVisibleIdSet?.(data.map(r => r.id));
            this.dataManager.emitFilterOptionsFromData(data);
            this.eventBus.emit('data:loaded', { count: data.length });
            this.statsManager.calculateFromData(data);
        };

        // FBC commit → re-apply client-side
        this.eventBus.on('filterByChart:apply', () => applyClient());

        // Legacy entry: GlobalSearch / FilterManager apply a single value.
        // Mirror it into FBC.selections then run the client pipeline.
        this.eventBus.on('filters:apply', async ({ filters }) => {
            const fbc = this.filterByChart;
            if (!fbc) return;
            const sel = fbc.getSelections();
            for (const [k, set] of Object.entries(sel)) {
                set.clear();
                const v = filters?.[k];
                if (v != null && v !== '') set.add(String(v));
            }
            applyClient();
        });

        // Numeric brush release → re-apply client-side (FBC also commits, this
        // is a defensive secondary path for any external slider movement).
        this.eventBus.on('numericRanges:changed', () => applyClient());

        // SQL filter applied — re-apply the full client-side pipeline (which
        // reads stateManager.activeSqlFilter and stacks it after FBC + ranges).
        this.eventBus.on('sqlFilter:applied', () => applyClient());

        // SQL filter cleared — re-apply client-side (no server fetch needed).
        this.eventBus.on('sqlFilter:cleared', () => applyClient());

        // Marker / polygon click → detail modal
        this.eventBus.on('marker:clicked', async ({ lagoonId, previewGeojson = null, centroidLat = null, centroidLng = null }) => {
            try {
                const [lagoon, geometry] = await Promise.all([
                    this.dataManager.fetchLagoonDetails(lagoonId),
                    this.dataManager.fetchLagoonGeometryById(lagoonId)
                ]);

                const fallbackPreview = {
                    geojson: previewGeojson || lagoon?.geojson || null,
                    centroid_lat: centroidLat ?? lagoon?.centroid_lat ?? null,
                    centroid_lng: centroidLng ?? lagoon?.centroid_lng ?? null
                };

                this.modalManager.showLagoonDetails(lagoon, geometry || fallbackPreview);
            } catch (err) {
                console.error('Error loading lagoon details:', err);
                this.uiController.showError('Failed to load lagoon details.');
            }
        });

        this.eventBus.on('ui:showLoading',          () => this.stateManager.set('isLoading', true));
        this.eventBus.on('ui:hideLoading',          () => this.stateManager.set('isLoading', false));
        this.eventBus.on('ui:aboutClicked',         () => this.modalManager.openModal('welcome-modal'));
        this.eventBus.on('ui:referencesClicked',    () => this.modalManager.openModal('references-modal'));
        this.eventBus.on('ui:submitDataClicked',    () => this.modalManager.openModal('submit-data-modal'));
        this.eventBus.on('ui:reportBugClicked',     () => this.modalManager.openModal('report-bug-modal'));
        this.eventBus.on('ui:submitSuggestionClicked', () => this.modalManager.openModal('submit-suggestion-modal'));
        this.eventBus.on('ui:sqlFilterClicked',     () => this.modalManager.openModal('sql-filter-modal'));

        this.stateManager.subscribe('isLoading', loading => this.showLoading(loading));
    }

    setupModalButtonHandlers() {
        // Submit-data email
        document.getElementById('send-email-btn')?.addEventListener('click', () => {
            const name  = document.getElementById('submit-name')?.value  || '';
            const email = document.getElementById('submit-email')?.value || '';
            const data  = document.getElementById('submit-data')?.value  || '';
            const notes = document.getElementById('submit-notes')?.value || '';
            this.emailHelper.openSubmitDataEmail({ name_en: name, notes: `${data}\n${notes}` });
        });

        // Bug-report email
        document.getElementById('send-bug-btn')?.addEventListener('click', () => {
            const desc  = document.getElementById('bug-description')?.value || '';
            const steps = document.getElementById('bug-steps')?.value       || '';
            this.emailHelper.openBugReportEmail({ description: desc, steps });
        });

        // Suggestion email
        document.getElementById('send-suggestion-btn')?.addEventListener('click', () => {
            const suggestion = document.getElementById('suggestion-text')?.value || '';
            this.emailHelper.openSuggestionEmail({ suggestion });
        });
    }

    // ── Data loading ─────────────────────────────────────────────────────────

    async loadInitialData() {
        this.stateManager.set('isLoading', true);
        try {
            const opts = await this.dataManager.fetchFilterOptions({});
            this.queryBuilder.setFilterOptions?.(opts);

            const data = (await this.dataManager.fetchLagoonData({})).map(normaliseVlmSentinels);
            this.stateManager.set('currentData', data);
            this.markerManager.updateMarkers(data);
            this.eventBus.emit('data:loaded', { count: data.length });
            this.statsManager.calculateFromData(data);

            this._fitMapToData(data);
        } finally {
            this.stateManager.set('isLoading', false);
        }
    }

    /**
     * Frame the map to the dataset's geographic extent with a generous buffer,
     * so all lagoons are visible on first paint regardless of viewport size.
     */
    _fitMapToData(records) {
        if (!Array.isArray(records) || records.length === 0) return;
        const map = this.mapManager?.getMap?.();
        if (!map) return;

        let latMin = Infinity, latMax = -Infinity, lngMin = Infinity, lngMax = -Infinity;
        for (const r of records) {
            const lat = parseFloat(r?.centroid_lat);
            const lng = parseFloat(r?.centroid_lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            if (lat < latMin) latMin = lat;
            if (lat > latMax) latMax = lat;
            if (lng < lngMin) lngMin = lng;
            if (lng > lngMax) lngMax = lng;
        }
        if (!Number.isFinite(latMin)) return;

        // 5 % buffer on each side so markers near the extreme corners aren't squashed against the edge
        const latPad = (latMax - latMin) * 0.05 || 0.1;
        const lngPad = (lngMax - lngMin) * 0.05 || 0.1;
        const bounds = L.latLngBounds(
            [latMin - latPad, lngMin - lngPad],
            [latMax + latPad, lngMax + lngPad]
        );

        try { map.invalidateSize(false); } catch (_) {}
        map.fitBounds(bounds, { animate: false, padding: [40, 40], maxZoom: 8 });
    }

    showLoading(show) {
        const el = document.getElementById('loading');
        if (el) el.classList.toggle('hidden', !show);
    }
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
    const app = new LagoonMapApplication();
    app.init();
});
