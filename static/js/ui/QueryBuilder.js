/**
 * QueryBuilder - SQL-like filter query builder for Greek Lagoons
 * Client-side data filtering on already-fetched marker records.
 */

import { escapeHtml } from '../utils/helpers.js';

class QueryBuilder {
    constructor(eventBus, stateManager, dataManager) {
        this.eventBus    = eventBus;
        this.stateManager = stateManager;
        this.dataManager  = dataManager;

        this.conditions  = [];
        this.conditionId = 0;
        this.filterOptions = {};

        this.fields = [
            { value: 'name_en',          label: 'Name',       type: 'text'   },
            { value: 'location_en',      label: 'Location',   type: 'text'   },
            { value: 'island_en',        label: 'Island',     type: 'text'   },
            { value: 'area_km2',         label: 'Area (km²)', type: 'number' },
            { value: 'height_m',         label: 'Height (m)', type: 'number' },
            { value: 'rcp2_6_inundated', label: 'RCP 2.6',   type: 'text'   },
            { value: 'rcp8_5_inundated', label: 'RCP 8.5',   type: 'text'   }
        ];

        this.operators = {
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

        this.elements = {};
    }

    init() {
        this.cacheElements();
        this.initEventListeners();
        this.addCondition();
        if (window.DEBUG_MODE) console.log('✅ QueryBuilder: Initialized');
    }

    cacheElements() {
        this.elements = {
            container:       document.getElementById('query-conditions'),
            previewText:     document.getElementById('query-preview-text'),
            addConditionBtn: document.getElementById('add-condition'),
            addGroupBtn:     document.getElementById('add-group'),
            applyBtn:        document.getElementById('apply-sql-filter'),
            clearBtn:        document.getElementById('clear-sql-filter'),
            errorDiv:        document.getElementById('sql-filter-error'),
            activeDiv:       document.getElementById('sql-filter-active'),
            activeQuery:     document.getElementById('sql-active-query'),
            modal:           document.getElementById('sql-filter-modal')
        };
    }

    initEventListeners() {
        this.elements.addConditionBtn?.addEventListener('click', () => this.addCondition());
        this.elements.addGroupBtn?.addEventListener('click',     () => this.addGroup());
        this.elements.applyBtn?.addEventListener('click',        () => this.applyFilter());
        this.elements.clearBtn?.addEventListener('click',        () => this.clearFilter());

        this.eventBus.on('filterOptions:loaded', ({ options }) => {
            this.filterOptions = options;
            this.renderConditions();
        });

        this.eventBus.on('sqlFilter:clear',    () => this.clearFilter(true));
        this.eventBus.on('ui:sqlFilterClicked', () => this.renderConditions());
    }

    // ── Condition management ─────────────────────────────────────────────────

    addCondition(parentId = null) {
        const id   = ++this.conditionId;
        const cond = { id, parentId, logic: 'AND', field: 'location_en', operator: 'eq', value: '' };
        this.conditions.push(cond);
        this.renderConditions();
        this.updatePreview();
        return id;
    }

    addGroup() {
        const groupId = ++this.conditionId;
        const condId  = ++this.conditionId;
        const group   = {
            id: groupId, isGroup: true, logic: 'AND',
            conditions: [{ id: condId, logic: 'AND', field: 'location_en', operator: 'eq', value: '' }]
        };
        this.conditions.push(group);
        this.renderConditions();
        this.updatePreview();
    }

    removeCondition(id) {
        this.conditions = this.conditions.filter(c => c.id !== id);
        this.conditions.forEach(item => {
            if (item.isGroup && item.conditions) {
                item.conditions = item.conditions.filter(c => c.id !== id);
            }
        });
        this.conditions = this.conditions.filter(item => !item.isGroup || item.conditions?.length > 0);
        this.renderConditions();
        this.updatePreview();
    }

    addConditionToGroup(groupId) {
        const group = this.conditions.find(c => c.id === groupId && c.isGroup);
        if (!group) return;
        const id = ++this.conditionId;
        group.conditions.push({ id, logic: 'AND', field: 'location_en', operator: 'eq', value: '' });
        this.renderConditions();
        this.updatePreview();
    }

    updateCondition(id, property, value) {
        let cond = this.conditions.find(c => c.id === id);
        if (!cond) {
            for (const item of this.conditions) {
                if (item.isGroup && item.conditions) {
                    cond = item.conditions.find(c => c.id === id);
                    if (cond) break;
                }
            }
        }

        if (cond) {
            cond[property] = value;
            if (property === 'field') {
                const def = this.fields.find(f => f.value === value);
                cond.operator = this.operators[def?.type || 'text'][0].value;
                this.renderConditions();
            }
            this.updatePreview();
        }
    }

    // ── Rendering ────────────────────────────────────────────────────────────

    renderConditions() {
        const { container } = this.elements;
        if (!container) return;
        container.innerHTML = '';
        this.conditions.forEach((item, i) => {
            container.appendChild(item.isGroup ? this.renderGroup(item, i) : this.renderConditionRow(item, i));
        });
    }

    getFieldValues(fieldName) {
        const map = {
            location_en:      'locations',
            island_en:        'islands',
            rcp2_6_inundated: 'rcp2_6_values',
            rcp8_5_inundated: 'rcp8_5_values'
        };
        const key = map[fieldName];
        return key ? (this.filterOptions[key] || []) : [];
    }

    renderConditionRow(condition, index, isInGroup = false) {
        const row = document.createElement('div');
        row.className = 'query-condition-row' + (isInGroup ? ' grouped' : '');
        row.dataset.id = condition.id;

        const fieldDef    = this.fields.find(f => f.value === condition.field);
        const operators   = this.operators[fieldDef?.type || 'text'];
        const needsValue  = !['is_null', 'is_not_null'].includes(condition.operator);
        const fieldValues = this.getFieldValues(condition.field);

        const valueOpts = fieldValues.map(v =>
            `<option value="${escapeHtml(String(v))}" ${String(condition.value) === String(v) ? 'selected' : ''}>${escapeHtml(String(v))}</option>`
        ).join('');

        row.innerHTML = `
            ${index > 0
                ? `<div class="condition-logic">
                    <select data-id="${condition.id}" data-prop="logic">
                        <option value="AND" ${condition.logic === 'AND' ? 'selected' : ''}>AND</option>
                        <option value="OR"  ${condition.logic === 'OR'  ? 'selected' : ''}>OR</option>
                    </select></div>`
                : '<div class="condition-logic"><span class="condition-where">WHERE</span></div>'}
            <div class="condition-field">
                <select data-id="${condition.id}" data-prop="field">
                    ${this.fields.map(f =>
                        `<option value="${f.value}" ${condition.field === f.value ? 'selected' : ''}>${f.label}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="condition-operator">
                <select data-id="${condition.id}" data-prop="operator">
                    ${operators.map(op =>
                        `<option value="${op.value}" ${condition.operator === op.value ? 'selected' : ''}>${op.label}</option>`
                    ).join('')}
                </select>
            </div>
            ${needsValue
                ? `<div class="condition-value">
                    <select data-id="${condition.id}" data-prop="value">
                        <option value="">-- Select --</option>
                        ${valueOpts}
                    </select></div>`
                : '<div class="condition-value"></div>'}
            <button class="condition-remove" data-remove="${condition.id}" title="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>`;

        row.querySelectorAll('select').forEach(el => {
            el.addEventListener('change', e => {
                this.updateCondition(parseInt(e.target.dataset.id), e.target.dataset.prop, e.target.value);
            });
        });

        row.querySelector('.condition-remove')?.addEventListener('click', e => {
            this.removeCondition(parseInt(e.currentTarget.dataset.remove));
        });

        return row;
    }

    renderGroup(group, index) {
        const el = document.createElement('div');
        el.className = 'query-group';
        el.dataset.id = group.id;

        el.innerHTML = `
            <div class="query-group-header">
                ${index > 0
                    ? `<div class="condition-logic">
                        <select data-id="${group.id}" data-prop="logic">
                            <option value="AND" ${group.logic === 'AND' ? 'selected' : ''}>AND</option>
                            <option value="OR"  ${group.logic === 'OR'  ? 'selected' : ''}>OR</option>
                        </select></div>`
                    : ''}
                <span class="query-group-label">( Group )</span>
                <div class="query-group-actions">
                    <button class="btn-add-condition" data-add-to-group="${group.id}">+ Add</button>
                    <button class="condition-remove" data-remove="${group.id}" title="Remove group">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="query-group-conditions"></div>`;

        const condContainer = el.querySelector('.query-group-conditions');
        group.conditions.forEach((c, i) => condContainer.appendChild(this.renderConditionRow(c, i, true)));

        el.querySelector('[data-add-to-group]')?.addEventListener('click', e => {
            this.addConditionToGroup(parseInt(e.currentTarget.dataset.addToGroup));
        });

        el.querySelector('.query-group-header .condition-logic select')?.addEventListener('change', e => {
            this.updateCondition(parseInt(e.target.dataset.id), 'logic', e.target.value);
        });

        el.querySelector('.query-group-header .condition-remove')?.addEventListener('click', e => {
            this.removeCondition(parseInt(e.currentTarget.dataset.remove));
        });

        return el;
    }

    // ── Preview ──────────────────────────────────────────────────────────────

    updatePreview() {
        const { previewText } = this.elements;
        if (!previewText) return;
        const qs = this.buildQueryString(this.conditions);
        previewText.innerHTML = qs || '<em>No conditions added</em>';
    }

    buildQueryString(conditions, isNested = false) {
        const parts = [];
        conditions.forEach((item, index) => {
            let part = '';

            if (item.isGroup) {
                const inner = this.buildQueryString(item.conditions, true);
                if (inner) part = `<span class="query-logic">(</span>${inner}<span class="query-logic">)</span>`;
            } else {
                const fDef  = this.fields.find(f => f.value === item.field);
                const ops   = this.operators[fDef?.type || 'text'];
                const opDef = ops.find(o => o.value === item.operator);

                if (item.operator === 'is_null') {
                    part = `<span class="query-field">${fDef?.label || item.field}</span> <span class="query-operator">Is Empty</span>`;
                } else if (item.operator === 'is_not_null') {
                    part = `<span class="query-field">${fDef?.label || item.field}</span> <span class="query-operator">Is Not Empty</span>`;
                } else if (item.value !== undefined && item.value !== '') {
                    const dv = fDef?.type === 'number' ? item.value : `"${item.value}"`;
                    part = `<span class="query-field">${fDef?.label || item.field}</span> <span class="query-operator">${opDef?.label || item.operator}</span> <span class="query-value">${escapeHtml(dv)}</span>`;
                }
            }

            if (part) {
                parts.push(parts.length > 0
                    ? `<span class="query-logic"> ${item.logic} </span>${part}`
                    : part);
            }
        });

        return parts.join('');
    }

    // ── Apply / Clear ────────────────────────────────────────────────────────

    async applyFilter() {
        const { errorDiv, activeDiv, activeQuery, modal } = this.elements;
        errorDiv?.classList.add('hidden');

        const valid = this.getValidConditions(this.conditions);
        if (valid.length === 0) {
            this.showError('Please add at least one complete condition');
            return;
        }

        try {
            this.eventBus.emit('ui:showLoading');

            const base = this.stateManager.get('currentData') || [];
            const data = this.filterData(base, this.conditions);

            this.stateManager.set('activeSqlFilter', JSON.parse(JSON.stringify(this.conditions)));
            this.eventBus.emit('sqlFilter:applied', { data, conditions: this.conditions });

            if (activeDiv && activeQuery) {
                activeQuery.innerHTML = this.buildQueryString(this.conditions);
                activeDiv.classList.remove('hidden');
            }

            modal?.classList.remove('active');
            document.body.classList.remove('modal-open');
        } catch (err) {
            console.error('QueryBuilder:', err);
            this.showError(err.message || 'Query failed');
        } finally {
            this.eventBus.emit('ui:hideLoading');
        }
    }

    clearFilter(silent = false) {
        const { activeDiv, errorDiv } = this.elements;
        this.stateManager.set('activeSqlFilter', null);
        activeDiv?.classList.add('hidden');
        errorDiv?.classList.add('hidden');

        if (!silent) this.eventBus.emit('sqlFilter:cleared');
    }

    showError(message) {
        const { errorDiv } = this.elements;
        if (!errorDiv) return;
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
    }

    // ── Data filtering (client-side) ─────────────────────────────────────────

    filterData(data, conditions) {
        if (!data?.length) return [];
        if (!this.getValidConditions(conditions).length) return data;
        return data.filter(row => this.evaluateList(row, conditions));
    }

    evaluateList(row, conditions) {
        let result = null;
        for (const item of conditions) {
            const r = item.isGroup
                ? this.evaluateList(row, item.conditions || [])
                : this.evaluateSingle(row, item);

            result = result === null ? r
                : item.logic === 'OR' ? (result || r) : (result && r);
        }
        return result ?? true;
    }

    evaluateSingle(row, cond) {
        const fv = row?.[cond.field];

        if (cond.operator === 'is_null')     return fv == null || fv === '';
        if (cond.operator === 'is_not_null') return fv != null && fv !== '';
        if (cond.value === undefined || cond.value === '') return true;

        const isNum = typeof fv === 'number' || (!Number.isNaN(Number(fv)) && fv !== '');
        const L = isNum ? Number(fv)          : String(fv ?? '');
        const R = isNum ? Number(cond.value)  : String(cond.value);

        switch (cond.operator) {
            case 'eq':  return L === R;
            case 'neq': return L !== R;
            case 'gt':  return L > R;
            case 'gte': return L >= R;
            case 'lt':  return L < R;
            case 'lte': return L <= R;
            default:    return true;
        }
    }

    getValidConditions(conditions) {
        const valid = [];
        conditions.forEach(item => {
            if (item.isGroup) {
                valid.push(...this.getValidConditions(item.conditions));
            } else if (['is_null', 'is_not_null'].includes(item.operator) ||
                       (item.value !== undefined && item.value !== '')) {
                valid.push(item);
            }
        });
        return valid;
    }
}

export default QueryBuilder;
