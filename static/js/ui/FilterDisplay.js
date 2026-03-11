/**
 * FilterDisplay - Active filter badges for Lagoons
 */

import { escapeHtml } from '../utils/helpers.js';

class FilterDisplay {
    constructor(eventBus, stateManager) {
        this.eventBus = eventBus;
        this.stateManager = stateManager;

        this.elements = {
            activeFiltersSummary: null,
            activeFiltersList:    null,
            mobileToggle:         null
        };

        this.filterLabels = {
            name:             'Name',
            location:         'Location',
            island:           'Island',
            rcp2_6_inundated: 'SSP1-2.6',
            rcp8_5_inundated: 'SSP5-8.5'
        };

        this.queryBuilderFields = [
            { value: 'name_en',          label: 'Name',         type: 'text'   },
            { value: 'location_en',      label: 'Location',     type: 'text'   },
            { value: 'island_en',        label: 'Island',       type: 'text'   },
            { value: 'area_km2',         label: 'Area (km²)',   type: 'number' },
            { value: 'height_m',         label: 'Height (m)',   type: 'number' },
            { value: 'rcp2_6_inundated', label: 'SSP1-2.6',    type: 'text'   },
            { value: 'rcp8_5_inundated', label: 'SSP5-8.5',    type: 'text'   }
        ];

        this.queryBuilderOperators = {
            number: [
                { value: 'eq',          label: '='            },
                { value: 'neq',         label: '≠'            },
                { value: 'gt',          label: '>'            },
                { value: 'gte',         label: '≥'            },
                { value: 'lt',          label: '<'            },
                { value: 'lte',         label: '≤'            },
                { value: 'is_null',     label: 'Is Empty'     },
                { value: 'is_not_null', label: 'Is Not Empty' }
            ],
            text: [
                { value: 'eq',          label: 'Equals'       },
                { value: 'neq',         label: 'Not Equals'   },
                { value: 'is_null',     label: 'Is Empty'     },
                { value: 'is_not_null', label: 'Is Not Empty' }
            ]
        };
    }

    init() {
        this.cacheElements();
        this.initEventListeners();
        if (window.DEBUG_MODE) console.log('✅ FilterDisplay: Initialized');
    }

    cacheElements() {
        this.elements = {
            activeFiltersSummary: document.getElementById('active-filters-summary'),
            activeFiltersList:    document.getElementById('active-filters-list'),
            mobileToggle:         document.getElementById('mobile-filters-toggle')
        };
    }

    initEventListeners() {
        this.eventBus.on('filters:apply',    ({ filters }) => this.updateDisplay(filters));
        this.eventBus.on('sqlFilter:applied', ()           => this.updateDisplay({}));
        this.eventBus.on('sqlFilter:cleared', ()           => this.updateDisplay({}));
    }

    updateDisplay(filters) {
        this.updateActiveFiltersBadges(filters);
        this.updateMobileIndicator(filters);
    }

    updateActiveFiltersBadges(filters) {
        const { activeFiltersSummary, activeFiltersList } = this.elements;
        if (!activeFiltersSummary || !activeFiltersList) return;

        activeFiltersList.innerHTML = '';

        const activeSqlFilter = this.stateManager.get('activeSqlFilter');
        let count = Object.values(filters).filter(v => v !== null && v !== '').length;

        if (activeSqlFilter && this._getValidConditions(activeSqlFilter).length > 0) {
            count++;
            this._addSqlFilterBadges(activeFiltersList, activeSqlFilter);
        }

        if (count === 0) {
            activeFiltersSummary.classList.add('hidden');
            return;
        }

        activeFiltersSummary.classList.remove('hidden');

        Object.entries(filters).forEach(([key, value]) => {
            if (value !== null && value !== '') {
                activeFiltersList.appendChild(
                    this._createBadge(this.filterLabels[key] || key, value, key)
                );
            }
        });
    }

    _createBadge(label, value, filterKey) {
        const badge = document.createElement('div');
        badge.className = 'filter-badge';

        badge.innerHTML = `
            <span class="filter-badge-label">${escapeHtml(label)}:</span>
            <span class="filter-badge-value">${escapeHtml(String(value))}</span>
            <button class="filter-badge-remove" type="button" aria-label="Remove ${escapeHtml(label)}">&times;</button>
        `;

        badge.querySelector('.filter-badge-remove').addEventListener('click', () => {
            this.eventBus.emit('filter:removeIndividual', { filterKey });
        });

        return badge;
    }

    _addSqlFilterBadges(container, sqlFilter) {
        this._getValidConditions(sqlFilter).forEach(condition => {
            const badge = document.createElement('div');
            badge.className = 'filter-badge filter-badge-sql';

            const fieldDef = this.queryBuilderFields.find(f => f.value === condition.field);
            const ops      = this.queryBuilderOperators[fieldDef?.type || 'text'];
            const opDef    = ops?.find(o => o.value === condition.operator);

            let valueText;
            if (condition.operator === 'is_null')     valueText = 'Is Empty';
            else if (condition.operator === 'is_not_null') valueText = 'Is Not Empty';
            else valueText = `${opDef?.label || condition.operator} ${condition.value}`;

            badge.innerHTML = `
                <span class="filter-badge-label">${escapeHtml(fieldDef?.label || condition.field)}</span>
                <span class="filter-badge-value">${escapeHtml(valueText)}</span>
                <button class="filter-badge-remove" type="button" title="Clear query">&times;</button>
            `;

            badge.querySelector('.filter-badge-remove').addEventListener('click', () => {
                this.eventBus.emit('sqlFilter:clear');
            });

            container.appendChild(badge);
        });
    }

    _getValidConditions(conditions) {
        const valid = [];
        conditions.forEach(item => {
            if (item.isGroup && item.conditions) {
                valid.push(...this._getValidConditions(item.conditions));
            } else if (['is_null', 'is_not_null'].includes(item.operator) ||
                       (item.value !== undefined && item.value !== '')) {
                valid.push(item);
            }
        });
        return valid;
    }

    updateMobileIndicator(filters) {
        const { mobileToggle } = this.elements;
        if (!mobileToggle) return;

        const active = Object.keys(filters).filter(k => filters[k] !== null && filters[k] !== '');
        const hasSql = this.stateManager.get('activeSqlFilter') &&
                       this._getValidConditions(this.stateManager.get('activeSqlFilter') || []).length > 0;
        const total  = active.length + (hasSql ? 1 : 0);

        mobileToggle.textContent = total > 0 ? `Filters (${total})` : 'Filters';
    }
}

export default FilterDisplay;
