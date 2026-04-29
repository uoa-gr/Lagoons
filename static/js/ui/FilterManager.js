/**
 * FilterManager - Modal-based filter UI for Greek Lagoons
 * Filters: Name / Location / Island / SSP1-2.6 Inundated / SSP5-8.5 Inundated
 */

import { escapeHtml, debounce } from '../utils/helpers.js';

class FilterManager {
    constructor(eventBus, stateManager, dataManager) {
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.dataManager = dataManager;

        this.isUpdatingFilters = false;
        this.filterElements = {};
        this.modalElements = {};

        this.currentOptions = {};
        this.allOptions = {};

        this.activeFilterKey = null;

        this.filterConfig = {
            name: {
                label: 'Name',
                optionsKey: 'names',
                defaultText: 'All Names',
                searchable: true
            },
            location: {
                label: 'Location',
                optionsKey: 'locations',
                defaultText: 'All Locations',
                searchable: true
            },
            island: {
                label: 'Island',
                optionsKey: 'islands',
                defaultText: 'All Islands',
                searchable: true
            },
            rcp2_6_inundated: {
                label: 'SSP1-2.6 Inundated',
                optionsKey: 'rcp2_6_values',
                defaultText: 'All',
                searchable: false
            },
            rcp8_5_inundated: {
                label: 'SSP5-8.5 Inundated',
                optionsKey: 'rcp8_5_values',
                defaultText: 'All',
                searchable: false
            }
        };
    }

    async applyFilterValue(filterKey, value) {
        if (!filterKey || value === undefined || value === null) return;

        const hiddenInput = this.filterElements[filterKey];
        if (!hiddenInput) return;

        hiddenInput.value = value;
        this.updateSelectorValue(filterKey, value);
        await this.handleFilterChange();
    }

    init() {
        this.cacheElements();
        this.initEventListeners();
        this.initStateSubscriptions();

        if (window.DEBUG_MODE) {
            console.log('✅ FilterManager: Initialized');
        }
    }

    cacheElements() {
        this.filterElements = {
            name: document.getElementById('name-filter'),
            nameBtn: document.getElementById('name-filter-btn'),
            nameBadge: document.getElementById('name-filter-badge'),
            location: document.getElementById('location-filter'),
            locationBtn: document.getElementById('location-filter-btn'),
            locationBadge: document.getElementById('location-filter-badge'),
            island: document.getElementById('island-filter'),
            islandBtn: document.getElementById('island-filter-btn'),
            islandBadge: document.getElementById('island-filter-badge'),
            rcp2_6_inundated: document.getElementById('rcp26-filter'),
            rcp2_6_inundatedBtn: document.getElementById('rcp26-filter-btn'),
            rcp2_6_inundatedBadge: document.getElementById('rcp26-filter-badge'),
            rcp8_5_inundated: document.getElementById('rcp85-filter'),
            rcp8_5_inundatedBtn: document.getElementById('rcp85-filter-btn'),
            rcp8_5_inundatedBadge: document.getElementById('rcp85-filter-badge'),
            clearBtn: document.getElementById('clear-filters'),
            activeFiltersSummary: document.getElementById('active-filters-summary'),
            activeFiltersList: document.getElementById('active-filters-list'),
            filterLoading: document.getElementById('filter-loading'),
            filterError: document.getElementById('filter-error')
        };

        this.modalElements = {
            modal: document.getElementById('filter-selection-modal'),
            title: document.getElementById('filter-modal-title'),
            searchInput: document.getElementById('filter-modal-search-input'),
            list: document.getElementById('filter-modal-list'),
            unavailableSection: document.getElementById('filter-modal-unavailable-section'),
            unavailableList: document.getElementById('filter-modal-unavailable-list'),
            clearBtn: document.getElementById('filter-modal-clear'),
            closeBtn: document.getElementById('close-filter-selection')
        };
    }

    initEventListeners() {
        Object.keys(this.filterConfig).forEach(filterKey => {
            const btn = this.filterElements[`${filterKey}Btn`];
            if (btn) {
                btn.addEventListener('click', () => this.openFilterModal(filterKey));
            }
        });

        if (this.filterElements.clearBtn) {
            this.filterElements.clearBtn.addEventListener('click', () => this.clearFilters());
        }

        if (this.modalElements.closeBtn) {
            this.modalElements.closeBtn.addEventListener('click', () => this.closeFilterModal());
        }

        if (this.modalElements.modal) {
            this.modalElements.modal.addEventListener('click', (e) => {
                if (e.target === this.modalElements.modal) {
                    this.closeFilterModal();
                }
            });
        }

        if (this.modalElements.clearBtn) {
            this.modalElements.clearBtn.addEventListener('click', () => this.clearCurrentFilter());
        }

        if (this.modalElements.searchInput) {
            this.modalElements.searchInput.addEventListener('input', debounce(() => {
                this.filterModalOptions();
            }, 150));
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modalElements.modal?.classList.contains('active')) {
                this.closeFilterModal();
            }
        });
    }

    initStateSubscriptions() {
        this.eventBus.on('filterOptions:loaded', ({ options, allOptions }) => {
            this.currentOptions = options;
            if (allOptions) {
                this.allOptions = allOptions;
            }
            this.updateAllBadges();
            this.updateSelectorValues();
        });

        this.eventBus.on('filter:removeIndividual', ({ filterKey }) => {
            this.clearIndividualFilter(filterKey);
        });
    }

    getOptionValue(option) {
        if (option && typeof option === 'object') {
            return option.value ?? option.name_en ?? '';
        }
        return option;
    }

    getOptionLabel(option) {
        if (option && typeof option === 'object') {
            if (option.label != null && option.label !== '') {
                return String(option.label);
            }

            const value = this.getOptionValue(option);
            const location = option.location ?? option.location_en ?? '';
            if (location) return `${value} (${location})`;
            return String(value);
        }

        return String(option ?? '');
    }

    getOptionKey(option) {
        if (option && typeof option === 'object') {
            const value = this.getOptionValue(option);
            const location = option.location ?? option.location_en ?? '';
            return `${String(value)}|${String(location)}`;
        }
        return String(this.getOptionValue(option));
    }

    openFilterModal(filterKey) {
        this.activeFilterKey = filterKey;
        const config = this.filterConfig[filterKey];

        if (!config || !this.modalElements.modal) return;

        if (this.modalElements.title) {
            this.modalElements.title.textContent = `Select ${config.label}`;
        }

        if (this.modalElements.searchInput) {
            this.modalElements.searchInput.value = '';
            this.modalElements.searchInput.parentElement.style.display =
                config.searchable ? '' : 'none';
        }

        this.populateModalOptions();

        this.modalElements.modal.classList.add('active');
        document.body.classList.add('modal-open');

        setTimeout(() => {
            if (config.searchable && this.modalElements.searchInput) {
                this.modalElements.searchInput.focus();
            }
        }, 100);
    }

    closeFilterModal() {
        if (this.modalElements.modal) {
            this.modalElements.modal.classList.remove('active');
            document.body.classList.remove('modal-open');
        }
        this.activeFilterKey = null;
    }

    populateModalOptions() {
        if (!this.activeFilterKey) return;

        const config = this.filterConfig[this.activeFilterKey];
        const optionsKey = config.optionsKey;

        const availableOptions = this.currentOptions[optionsKey] || [];
        const allOptionsList = this.allOptions[optionsKey] || availableOptions;

        const currentValue = this.filterElements[this.activeFilterKey]?.value || '';

        const availableSet = new Set(availableOptions.map(option => this.getOptionKey(option)));
        const unavailableOptions = allOptionsList.filter(option => !availableSet.has(this.getOptionKey(option)));

        this.renderModalList(availableOptions, currentValue, false, config);
        this.renderUnavailableList(unavailableOptions, config);
    }

    renderModalList(options, currentValue, isFiltered = false, config = null) {
        const list = this.modalElements.list;
        if (!list) return;

        list.textContent = '';

        if (options.length === 0 && (!currentValue || currentValue === '')) {
            const empty = document.createElement('div');
            empty.className = 'filter-modal-no-results';
            empty.textContent = 'No options available';
            list.appendChild(empty);
            return;
        }

        if (currentValue && currentValue !== '') {
            const selectedDiv = document.createElement('div');
            selectedDiv.className = 'filter-modal-option selected-current';
            const selectedOption = options.find(option =>
                String(this.getOptionValue(option)) === String(currentValue)
            );
            selectedDiv.textContent = selectedOption
                ? this.getOptionLabel(selectedOption)
                : currentValue;
            selectedDiv.title = 'Currently selected — click "Clear Selection" to change';
            list.appendChild(selectedDiv);
        }

        options.forEach(option => {
            const optionValue = this.getOptionValue(option);
            if (String(optionValue) === String(currentValue)) return;

            const div = document.createElement('div');
            div.className = 'filter-modal-option';
            div.textContent = this.getOptionLabel(option);
            div.dataset.value = String(optionValue);
            div.addEventListener('click', () => this.selectFilterValue(optionValue));
            list.appendChild(div);
        });
    }

    renderUnavailableList(options, config = null) {
        const section = this.modalElements.unavailableSection;
        const list = this.modalElements.unavailableList;

        if (!section || !list) return;

        if (options.length === 0) {
            section.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');
        list.textContent = '';

        options.forEach(option => {
            const div = document.createElement('div');
            div.className = 'filter-modal-option unavailable';
            div.textContent = this.getOptionLabel(option);
            list.appendChild(div);
        });
    }

    filterModalOptions() {
        const searchTerm = this.modalElements.searchInput?.value?.toLowerCase() || '';
        const config = this.filterConfig[this.activeFilterKey];
        const optionsKey = config?.optionsKey;

        if (!optionsKey) return;

        const availableOptions = this.currentOptions[optionsKey] || [];
        const allOptionsList = this.allOptions[optionsKey] || availableOptions;
        const currentValue = this.filterElements[this.activeFilterKey]?.value || '';

        const filteredAvailable = searchTerm
            ? availableOptions.filter(option => {
                const label = this.getOptionLabel(option).toLowerCase();
                const value = String(this.getOptionValue(option)).toLowerCase();
                return label.includes(searchTerm) || value.includes(searchTerm);
            })
            : availableOptions;

        const availableSet = new Set(availableOptions.map(option => this.getOptionKey(option)));
        const unavailableOptions = allOptionsList.filter(option => !availableSet.has(this.getOptionKey(option)));
        const filteredUnavailable = searchTerm
            ? unavailableOptions.filter(option => {
                const label = this.getOptionLabel(option).toLowerCase();
                const value = String(this.getOptionValue(option)).toLowerCase();
                return label.includes(searchTerm) || value.includes(searchTerm);
            })
            : unavailableOptions;

        this.renderModalList(filteredAvailable, currentValue, true, config);
        this.renderUnavailableList(filteredUnavailable, config);
    }

    async selectFilterValue(value) {
        if (!this.activeFilterKey) return;

        const hiddenInput = this.filterElements[this.activeFilterKey];
        if (hiddenInput) {
            hiddenInput.value = value;
        }

        this.updateSelectorValue(this.activeFilterKey, value);
        this.closeFilterModal();
        await this.handleFilterChange();
    }

    async clearCurrentFilter() {
        if (!this.activeFilterKey) return;

        const hiddenInput = this.filterElements[this.activeFilterKey];
        if (hiddenInput) {
            hiddenInput.value = '';
        }

        this.updateSelectorValue(this.activeFilterKey, '');
        this.closeFilterModal();
        await this.handleFilterChange();
    }

    updateSelectorValue(filterKey, value) {
        const btn = this.filterElements[`${filterKey}Btn`];
        const config = this.filterConfig[filterKey];
        if (!btn || !config) return;

        const valueSpan = btn.querySelector('.filter-selector-value');
        if (valueSpan) {
            if (value && value !== '') {
                valueSpan.textContent = value;
                btn.classList.add('has-value');
            } else {
                valueSpan.textContent = config.defaultText;
                btn.classList.remove('has-value');
            }
        }
    }

    updateSelectorValues() {
        Object.keys(this.filterConfig).forEach(filterKey => {
            const value = this.filterElements[filterKey]?.value || '';
            this.updateSelectorValue(filterKey, value);
        });
    }

    updateAllBadges() {
        Object.keys(this.filterConfig).forEach(filterKey => {
            this.updateBadge(filterKey);
        });
    }

    updateBadge(filterKey) {
        const config = this.filterConfig[filterKey];
        const badge = this.filterElements[`${filterKey}Badge`];

        if (!badge || !config) return;

        const optionsKey = config.optionsKey;
        const currentCount = this.currentOptions[optionsKey]?.length || 0;
        const totalCount = this.allOptions[optionsKey]?.length || currentCount;

        const selectedValue = this.filterElements[filterKey]?.value;
        const hasSelection = selectedValue && selectedValue !== '';

        if (hasSelection || totalCount === 0) {
            badge.textContent = '';
            badge.className = 'filter-selector-badge';
            return;
        }

        badge.className = 'filter-selector-badge';
        badge.textContent = `${currentCount} of ${totalCount}`;

        if (currentCount === totalCount) {
            badge.classList.add('badge-full');
        } else {
            badge.classList.add('badge-filtered');
        }
    }

    async handleFilterChange() {
        this.isUpdatingFilters = true;

        try {
            const filters = this.getActiveFilters();
            this.showLoading(true);
            await this.dataManager.fetchFilterOptions(filters);
            this.eventBus.emit('filters:changed', { filters });
            await this.applyFilters();
        } finally {
            this.isUpdatingFilters = false;
            this.showLoading(false);
        }
    }

    getActiveFilters() {
        return {
            name: this.filterElements.name?.value || null,
            location: this.filterElements.location?.value || null,
            island: this.filterElements.island?.value || null,
            rcp2_6_inundated: this.filterElements.rcp2_6_inundated?.value || null,
            rcp8_5_inundated: this.filterElements.rcp8_5_inundated?.value || null
        };
    }

    async applyFilters() {
        const filters = this.getActiveFilters();

        const cleanFilters = {};
        let activeCount = 0;

        Object.entries(filters).forEach(([key, value]) => {
            if (value !== null && value !== '') {
                cleanFilters[key] = value;
                activeCount++;
            }
        });

        this.updateActiveFiltersDisplay(cleanFilters);
        this.updateMobileFilterIndicator(activeCount, cleanFilters);
        this.closeMobileSidebar();

        this.eventBus.emit('filters:apply', { filters: cleanFilters });
    }

    updateActiveFiltersDisplay(filters) {
        const { activeFiltersSummary, activeFiltersList } = this.filterElements;
        if (!activeFiltersSummary || !activeFiltersList) return;

        activeFiltersList.textContent = '';

        const filterLabels = {
            name: 'Name',
            location: 'Location',
            island: 'Island',
            rcp2_6_inundated: 'SSP1-2.6',
            rcp8_5_inundated: 'SSP5-8.5'
        };

        const activeCount = Object.keys(filters).length;

        if (activeCount === 0) {
            activeFiltersSummary.classList.add('hidden');
            return;
        }

        activeFiltersSummary.classList.remove('hidden');

        Object.entries(filters).forEach(([filterKey, filterValue]) => {
            const filterLabel = filterLabels[filterKey] || filterKey;
            const badge = this.createFilterBadge(filterLabel, filterValue, filterKey);
            activeFiltersList.appendChild(badge);
        });
    }

    createFilterBadge(label, value, filterKey) {
        const badge = document.createElement('div');
        badge.className = 'filter-badge';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'filter-badge-label';
        labelSpan.textContent = `${label}:`;

        const valueSpan = document.createElement('span');
        valueSpan.className = 'filter-badge-value';
        valueSpan.textContent = escapeHtml(String(value));

        const removeBtn = document.createElement('button');
        removeBtn.className = 'filter-badge-remove';
        removeBtn.textContent = '\u00d7';
        removeBtn.title = `Remove ${label} filter`;
        removeBtn.addEventListener('click', () => this.clearIndividualFilter(filterKey));

        badge.appendChild(labelSpan);
        badge.appendChild(valueSpan);
        badge.appendChild(removeBtn);

        return badge;
    }

    updateMobileFilterIndicator(count, filters) {
        const toggleBtn = document.getElementById('mobile-filters-toggle');
        if (!toggleBtn) return;

        if (count > 0) {
            if (window.innerWidth <= 480) {
                toggleBtn.textContent = `Filters (${count})`;
            } else {
                const filterNames = [];
                if (filters.name) filterNames.push('Name');
                if (filters.location) filterNames.push('Location');
                if (filters.island) filterNames.push('Island');
                if (filters.rcp2_6_inundated) filterNames.push('SSP1-2.6');
                if (filters.rcp8_5_inundated) filterNames.push('SSP5-8.5');
                toggleBtn.textContent = `Filters: ${filterNames.join(', ')}`;
            }
        } else {
            toggleBtn.textContent = 'Filters';
        }
    }

    closeMobileSidebar() {
        if (window.innerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            const toggleBtn = document.getElementById('mobile-filters-toggle');
            if (sidebar && toggleBtn) {
                sidebar.classList.remove('active');
                toggleBtn.classList.remove('active');
            }
        }
    }

    async clearIndividualFilter(filterKey) {
        const hiddenInput = this.filterElements[filterKey];
        if (hiddenInput) {
            hiddenInput.value = '';
        }

        this.updateSelectorValue(filterKey, '');

        const filters = this.getActiveFilters();
        await this.dataManager.fetchFilterOptions(filters);
        await this.applyFilters();
    }

    async clearFilters() {
        Object.keys(this.filterConfig).forEach(filterKey => {
            const hiddenInput = this.filterElements[filterKey];
            if (hiddenInput) {
                hiddenInput.value = '';
            }
            this.updateSelectorValue(filterKey, '');
        });

        if (this.filterElements.activeFiltersSummary) {
            this.filterElements.activeFiltersSummary.classList.add('hidden');
        }

        await this.dataManager.fetchFilterOptions({});
        this.updateMobileFilterIndicator(0, {});
        this.eventBus.emit('filters:apply', { filters: {} });
    }

    showLoading(show) {
        if (this.filterElements.filterLoading) {
            if (show) {
                this.filterElements.filterLoading.classList.remove('hidden');
            } else {
                this.filterElements.filterLoading.classList.add('hidden');
            }
        }

        Object.keys(this.filterConfig).forEach(filterKey => {
            const btn = this.filterElements[`${filterKey}Btn`];
            if (btn) {
                btn.style.opacity = show ? '0.6' : '1';
                btn.disabled = show;
            }
        });
    }

    showError(message) {
        if (this.filterElements.filterError) {
            this.filterElements.filterError.textContent = message;
            this.filterElements.filterError.classList.remove('hidden');
        }
    }

    hideError() {
        if (this.filterElements.filterError) {
            this.filterElements.filterError.classList.add('hidden');
        }
    }

    disableFilters() {
        Object.keys(this.filterConfig).forEach(filterKey => {
            const btn = this.filterElements[`${filterKey}Btn`];
            if (btn) {
                btn.disabled = true;
                btn.classList.add('filter-error-state');
            }
        });
    }
}

export default FilterManager;
