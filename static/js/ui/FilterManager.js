/**
 * FilterManager - Four filters for Greek Lagoons
 * Location / Island / RCP 2.6 Inundated / RCP 8.5 Inundated
 */

import { escapeHtml } from '../utils/helpers.js';

class FilterManager {
    constructor(eventBus, stateManager, dataManager) {
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.dataManager = dataManager;

        // Map UI filter keys → state/API keys
        this.filterConfig = {
            location: {
                label:       'Location',
                optionsKey:  'locations',
                defaultText: 'All Locations',
                selector:    '#location-filter'
            },
            island: {
                label:       'Island',
                optionsKey:  'islands',
                defaultText: 'All Islands',
                selector:    '#island-filter'
            },
            rcp2_6_inundated: {
                label:       'RCP 2.6 Inundated',
                optionsKey:  'rcp2_6_values',
                defaultText: 'All',
                selector:    '#rcp26-filter'
            },
            rcp8_5_inundated: {
                label:       'RCP 8.5 Inundated',
                optionsKey:  'rcp8_5_values',
                defaultText: 'All',
                selector:    '#rcp85-filter'
            }
        };

        this.activeFilters = {
            location:         null,
            island:           null,
            rcp2_6_inundated: null,
            rcp8_5_inundated: null
        };

        this.filterOptions = {
            locations:     [],
            islands:       [],
            rcp2_6_values: [],
            rcp8_5_values: []
        };

        this.elements = {};
    }

    init() {
        this.cacheElements();
        this.bindDropdownEvents();
        this.bindFilterOptionsUpdates();
        this.bindClearButtons();

        if (window.DEBUG_MODE) console.log('✅ FilterManager: Initialized');
    }

    cacheElements() {
        Object.entries(this.filterConfig).forEach(([key, cfg]) => {
            this.elements[key] = document.querySelector(cfg.selector);
        });

        this.elements.clearAllBtn   = document.getElementById('clear-all-filters');
        this.elements.filterSection = document.getElementById('filters-tab');
    }

    bindDropdownEvents() {
        Object.entries(this.filterConfig).forEach(([key, cfg]) => {
            const el = this.elements[key];
            if (!el) return;

            el.addEventListener('change', async () => {
                const value = el.value || null;
                this.activeFilters[key] = value;
                await this.applyFilters();
            });
        });
    }

    bindFilterOptionsUpdates() {
        this.eventBus.on('filterOptions:loaded', ({ options }) => {
            this.filterOptions = { ...this.filterOptions, ...options };
            this.populateDropdowns();
        });
    }

    bindClearButtons() {
        this.elements.clearAllBtn?.addEventListener('click', async () => {
            this.clearAllFilters();
            await this.applyFilters();
        });

        // Individual filter badges cleared from FilterDisplay
        this.eventBus.on('filter:removeIndividual', async ({ filterKey }) => {
            if (filterKey in this.activeFilters) {
                this.activeFilters[filterKey] = null;
                const el = this.elements[filterKey];
                if (el) el.value = '';
                await this.applyFilters();
            }
        });
    }

    populateDropdowns() {
        Object.entries(this.filterConfig).forEach(([key, cfg]) => {
            const el = this.elements[key];
            if (!el) return;

            const opts = this.filterOptions[cfg.optionsKey] || [];
            const current = this.activeFilters[key];

            // Keep current selection if it's still available
            el.innerHTML = `<option value="">${cfg.defaultText}</option>`;
            opts.forEach(val => {
                if (val == null || val === '') return;
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = val;
                if (val === current) opt.selected = true;
                el.appendChild(opt);
            });
        });
    }

    async applyFilters() {
        const filters = this.getActiveFilters();
        this.stateManager.set('activeFilters', filters);

        this.eventBus.emit('filters:apply', { filters });

        // Cross-filter: refresh options based on remaining context
        await this.dataManager.fetchFilterOptions(filters);
    }

    async applyFilterValue(key, value) {
        if (!(key in this.activeFilters)) return;

        this.activeFilters[key] = value || null;
        const el = this.elements[key];
        if (el) el.value = value || '';

        await this.applyFilters();
    }

    getActiveFilters() {
        const active = {};
        Object.entries(this.activeFilters).forEach(([k, v]) => {
            if (v !== null && v !== '') active[k] = v;
        });
        return active;
    }

    clearAllFilters() {
        Object.keys(this.activeFilters).forEach(k => {
            this.activeFilters[k] = null;
            const el = this.elements[k];
            if (el) el.value = '';
        });
    }

    updateActiveFiltersDisplay(filters) {
        Object.entries(this.filterConfig).forEach(([key, _]) => {
            const el = this.elements[key];
            if (el) el.value = filters[key] || '';
            this.activeFilters[key] = filters[key] || null;
        });
    }

    disableFilters() {
        Object.values(this.elements).forEach(el => {
            if (el && el.tagName === 'SELECT') el.disabled = true;
        });
    }
}

export default FilterManager;
