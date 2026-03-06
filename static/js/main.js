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
import MobileControls from './ui/MobileControls.js';
import StatusBar      from './ui/StatusBar.js';
import EmailHelper    from './utils/EmailHelper.js';
import DropdownLimiter from './utils/DropdownLimiter.js';

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
            this.mobileControls = new MobileControls(this.eventBus, this.stateManager);
            this.emailHelper    = new EmailHelper();
            this.dropdownLimiter = new DropdownLimiter();

            // Map
            this.mapManager.init('map');
            const map = this.mapManager.getMap();

            // Marker cluster layer
            this.markerManager = new MarkerManager(map, this.eventBus, this.stateManager);
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
        // Regular filter applied
        this.eventBus.on('filters:apply', async ({ filters }) => {
            this.stateManager.set('isLoading', true);
            try {
                const activeSql = this.stateManager.get('activeSqlFilter');

                let data;
                if (activeSql?.length) {
                    const base = await this.dataManager.fetchLagoonData(filters);
                    data = this.queryBuilder.filterData(base, activeSql);
                    this.stateManager.set('currentData', data);
                    this.dataManager.emitFilterOptionsFromData(data);
                } else {
                    data = await this.dataManager.fetchLagoonData(filters);
                }

                this.markerManager.updateMarkers(data);
                this.polygonManager.setFilters(filters);
                this.eventBus.emit('data:loaded', { count: data.length });
                this.statsManager.calculateFromData(data);
            } finally {
                this.stateManager.set('isLoading', false);
            }
        });

        // SQL (query-builder) filter applied
        this.eventBus.on('sqlFilter:applied', ({ data }) => {
            this.markerManager.updateMarkers(data);
            this.eventBus.emit('data:loaded', { count: data.length });
            this.statsManager.calculateFromData(data);
            this.dataManager.emitFilterOptionsFromData(data);
        });

        // SQL filter cleared — reload with regular filters
        this.eventBus.on('sqlFilter:cleared', async () => {
            const filters = this.filterManager.getActiveFilters();
            this.stateManager.set('isLoading', true);
            try {
                const data = await this.dataManager.fetchLagoonData(filters);
                this.markerManager.updateMarkers(data);
                this.polygonManager.setFilters(filters);
                this.eventBus.emit('data:loaded', { count: data.length });
                this.statsManager.calculateFromData(data);
                await this.dataManager.fetchFilterOptions(filters);
                this.filterManager.updateActiveFiltersDisplay(filters);
            } finally {
                this.stateManager.set('isLoading', false);
            }
        });

        // Marker / polygon click → detail modal
        this.eventBus.on('marker:clicked', async ({ lagoonId }) => {
            try {
                const lagoon = await this.dataManager.fetchLagoonDetails(lagoonId);
                this.modalManager.showLagoonDetails(lagoon);
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

            const data = await this.dataManager.fetchLagoonData({});
            this.markerManager.updateMarkers(data);
            this.eventBus.emit('data:loaded', { count: data.length });
            this.statsManager.calculateFromData(data);
        } finally {
            this.stateManager.set('isLoading', false);
        }
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
