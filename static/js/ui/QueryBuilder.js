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

        // Custom dropdown ("editorial select") state
        this._popover        = null;
        this._popoverBtn     = null;
        this._popoverHandlers = null;

        this.fields = [
            // Identification & geography
            { value: 'name_en',     label: 'Name',                  type: 'text', group: 'Identification' },
            { value: 'island_en',   label: 'Island',                type: 'text', group: 'Geography' },
            { value: 'location_en', label: 'Location (Prefecture)', type: 'text', group: 'Geography' },

            // Morphometry
            { value: 'area_km2',      label: 'Area (km²)',                type: 'number', group: 'Morphometry' },
            { value: 'perimeter_km2', label: 'Perimeter (km)',            type: 'number', group: 'Morphometry' },
            { value: 'length_m',      label: 'Length (m)',                type: 'number', group: 'Morphometry' },
            { value: 'width_m',       label: 'Width (m)',                 type: 'number', group: 'Morphometry' },
            { value: 'height_m',      label: 'Sandspit Max Height (m)',   type: 'number', group: 'Morphometry' },

            // SSP1-2.6
            { value: 'rcp2_6_slr',           label: 'SLR geocentric (m)',         type: 'number', group: 'SSP1-2.6 (low emissions)' },
            { value: 'rcp2_6_vec_slr',       label: 'SLR VLM-corrected (m)',      type: 'number', group: 'SSP1-2.6 (low emissions)' },
            { value: 'rcp2_6_inundated',     label: 'Inundated (geocentric)',     type: 'text',   group: 'SSP1-2.6 (low emissions)' },
            { value: 'rcp2_6_vec_inundated', label: 'Inundated (VLM-corrected)',  type: 'text',   group: 'SSP1-2.6 (low emissions)' },

            // SSP5-8.5
            { value: 'rcp8_5_slr',           label: 'SLR geocentric (m)',         type: 'number', group: 'SSP5-8.5 (high emissions)' },
            { value: 'rcp8_5_vec_slr',       label: 'SLR VLM-corrected (m)',      type: 'number', group: 'SSP5-8.5 (high emissions)' },
            { value: 'rcp8_5_inundated',     label: 'Inundated (geocentric)',     type: 'text',   group: 'SSP5-8.5 (high emissions)' },
            { value: 'rcp8_5_vec_inundated', label: 'Inundated (VLM-corrected)',  type: 'text',   group: 'SSP5-8.5 (high emissions)' }
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

    _renderFieldOptions(selected) {
        const groups = new Map();
        for (const f of this.fields) {
            const g = f.group || 'Other';
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g).push(f);
        }
        const opts = [];
        for (const [g, items] of groups) {
            opts.push(`<optgroup label="${escapeHtml(g)}">`);
            for (const f of items) {
                opts.push(`<option value="${f.value}" ${selected === f.value ? 'selected' : ''}>${escapeHtml(f.label)}</option>`);
            }
            opts.push(`</optgroup>`);
        }
        return opts.join('');
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
        // Any open popover refers to a button that's about to be destroyed
        this._closePicker?.();
        container.replaceChildren();
        this.conditions.forEach((item, i) => {
            container.appendChild(item.isGroup ? this.renderGroup(item, i) : this.renderConditionRow(item, i));
        });
    }

    getFieldValues(fieldName) {
        const map = {
            name_en:              'names',
            location_en:          'locations',
            island_en:            'islands',
            rcp2_6_inundated:     'rcp2_6_values',
            rcp8_5_inundated:     'rcp8_5_values',
            // VLM-corrected inundated columns share the same Yes/No vocabulary
            rcp2_6_vec_inundated: 'rcp2_6_values',
            rcp8_5_vec_inundated: 'rcp8_5_values'
        };
        const key = map[fieldName];
        return key ? (this.filterOptions[key] || []) : [];
    }

    getFieldStats(fieldName) {
        const data = this.stateManager?.get('currentData') || [];
        let min = Infinity, max = -Infinity, count = 0;
        for (const row of data) {
            const v = row?.[fieldName];
            if (v == null || v === '') continue;
            const n = Number(v);
            if (!Number.isFinite(n)) continue;
            if (n < min) min = n;
            if (n > max) max = n;
            count++;
        }
        return count > 0 ? { min, max, count } : null;
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
            return String(this.getOptionValue(option));
        }
        return String(option ?? '');
    }

    renderConditionRow(condition, index, isInGroup = false) {
        const row = document.createElement('div');
        row.className = 'query-condition-row' + (isInGroup ? ' grouped' : '');
        row.dataset.id = condition.id;

        const fieldDef   = this.fields.find(f => f.value === condition.field);
        const operators  = this.operators[fieldDef?.type || 'text'];
        const opDef      = operators.find(o => o.value === condition.operator);
        const needsValue = !['is_null', 'is_not_null'].includes(condition.operator);
        const valueLabel = this._lookupValueLabel(condition.field, condition.value);

        row.innerHTML = `
            ${index > 0
                ? `<div class="condition-logic">${this._buttonHtml({
                        prop: 'logic', id: condition.id, value: condition.logic,
                        label: condition.logic, variant: 'logic'
                    })}</div>`
                : '<div class="condition-logic"><span class="condition-where">where</span></div>'}
            <div class="condition-field">${this._buttonHtml({
                prop: 'field', id: condition.id, value: condition.field,
                label: fieldDef?.label || condition.field, variant: 'field'
            })}</div>
            <div class="condition-operator">${this._buttonHtml({
                prop: 'operator', id: condition.id, value: condition.operator,
                label: opDef?.label || condition.operator, variant: 'operator'
            })}</div>
            ${needsValue
                ? `<div class="condition-value">${this._valueControlHtml(condition, fieldDef)}</div>`
                : '<div class="condition-value"></div>'}
            <button class="condition-remove" data-remove="${condition.id}" title="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>`;

        row.querySelectorAll('.eds-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                this._openPicker(btn);
            });
        });

        row.querySelectorAll('.eds-input').forEach(inp => {
            const commit = () => this.updateCondition(
                parseInt(inp.dataset.id), inp.dataset.prop, inp.value
            );
            inp.addEventListener('input', commit);
            inp.addEventListener('change', commit);
        });

        row.querySelector('.condition-remove')?.addEventListener('click', e => {
            this.removeCondition(parseInt(e.currentTarget.dataset.remove));
        });

        return row;
    }

    /** Pick the right value control based on field type. */
    _valueControlHtml(condition, fieldDef) {
        const t = fieldDef?.type;
        if (t === 'number') {
            const stats = this.getFieldStats(condition.field);
            const placeholder = stats
                ? `${this._fmt(stats.min)} – ${this._fmt(stats.max)}`
                : 'Enter a number…';
            const step = stats && (stats.max - stats.min) < 10 ? 'any' : '1';
            return `<input type="number"
                           class="eds-input eds-input--number"
                           data-id="${condition.id}" data-prop="value"
                           value="${escapeHtml(String(condition.value ?? ''))}"
                           placeholder="${escapeHtml(placeholder)}"
                           step="${step}"
                           inputmode="decimal"
                           autocomplete="off">`;
        }

        // Text field with a known value list → editorial popover
        const vals = this.getFieldValues(condition.field);
        if (vals && vals.length > 0) {
            const valueLabel = this._lookupValueLabel(condition.field, condition.value);
            return this._buttonHtml({
                prop: 'value', id: condition.id, value: condition.value,
                label: valueLabel, placeholder: 'Select…', variant: 'value'
            });
        }

        // Free-text fallback
        return `<input type="text"
                       class="eds-input"
                       data-id="${condition.id}" data-prop="value"
                       value="${escapeHtml(String(condition.value ?? ''))}"
                       placeholder="Type a value…"
                       autocomplete="off">`;
    }

    _fmt(n) {
        if (!Number.isFinite(n)) return '';
        if (Math.abs(n) >= 100 || Number.isInteger(n)) return Math.round(n).toLocaleString();
        return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    _buttonHtml({ prop, id, value, label, placeholder, variant }) {
        const display = (label != null && label !== '') ? label : (placeholder || 'Select…');
        const isPlaceholder = !(label != null && label !== '');
        return `<button type="button" class="eds-btn eds-btn--${variant}"
                    data-id="${id}" data-prop="${prop}"
                    data-value="${escapeHtml(String(value ?? ''))}"
                    aria-haspopup="listbox" aria-expanded="false">
                <span class="eds-value${isPlaceholder ? ' is-placeholder' : ''}">${escapeHtml(String(display))}</span>
                <svg class="eds-chev" width="14" height="14" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="1.5"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </button>`;
    }

    _lookupValueLabel(fieldName, value) {
        if (value === undefined || value === null || value === '') return '';
        const vals = this.getFieldValues(fieldName);
        for (const v of vals) {
            if (String(this.getOptionValue(v)) === String(value)) {
                return this.getOptionLabel(v);
            }
        }
        return String(value);
    }

    // ── Editorial dropdown popover ───────────────────────────────────────────

    /** Resolve the option list, current value, and search-affordance for a button. */
    _resolveOptions(btn) {
        const id   = parseInt(btn.dataset.id);
        const prop = btn.dataset.prop;
        const cond = this._findEntry(id);
        if (!cond) return null;

        if (prop === 'logic') {
            return {
                id, prop,
                options: [{ value: 'AND', label: 'AND' }, { value: 'OR', label: 'OR' }],
                current: cond.logic, searchable: false, align: 'start'
            };
        }
        if (prop === 'field') {
            const opts = [];
            for (const f of this.fields) {
                opts.push({ value: f.value, label: f.label, group: f.group || 'Other' });
            }
            return { id, prop, options: opts, current: cond.field, searchable: true, align: 'start' };
        }
        if (prop === 'operator') {
            const fDef = this.fields.find(f => f.value === cond.field);
            const ops = this.operators[fDef?.type || 'text'];
            return {
                id, prop,
                options: ops.map(o => ({ value: o.value, label: o.label })),
                current: cond.operator, searchable: false, align: 'start'
            };
        }
        if (prop === 'value') {
            const raw = this.getFieldValues(cond.field);
            const opts = raw.map(v => ({ value: this.getOptionValue(v), label: this.getOptionLabel(v) }));
            return {
                id, prop,
                options: opts,
                current: cond.value,
                searchable: opts.length >= 8,
                align: 'start'
            };
        }
        return null;
    }

    /** Find a condition or group entry by id, in or out of groups. */
    _findEntry(id) {
        let entry = this.conditions.find(c => c.id === id);
        if (entry) return entry;
        for (const item of this.conditions) {
            if (item.isGroup && item.conditions) {
                entry = item.conditions.find(c => c.id === id);
                if (entry) return entry;
            }
        }
        return null;
    }

    _openPicker(btn) {
        if (this._popoverBtn === btn) { this._closePicker(); return; }
        this._closePicker();

        const ctx = this._resolveOptions(btn);
        if (!ctx) return;

        const pop = document.createElement('div');
        pop.className = `eds-popover eds-popover--${btn.dataset.prop}`;
        pop.setAttribute('role', 'listbox');

        let searchInput = null;
        if (ctx.searchable) {
            const sw = document.createElement('div');
            sw.className = 'eds-search-wrap';
            sw.innerHTML = `<input type="text" class="eds-search" placeholder="Search…" autocomplete="off">`;
            pop.appendChild(sw);
            searchInput = sw.querySelector('.eds-search');
        }

        const list = document.createElement('div');
        list.className = 'eds-list';
        pop.appendChild(list);

        const renderRows = (filter = '') => {
            list.replaceChildren();
            let lastGroup = null, count = 0;
            for (const opt of ctx.options) {
                if (filter && !String(opt.label).toLowerCase().includes(filter)) continue;
                if (opt.group && opt.group !== lastGroup) {
                    const h = document.createElement('div');
                    h.className = 'eds-group';
                    h.textContent = opt.group;
                    list.appendChild(h);
                    lastGroup = opt.group;
                }
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'eds-option' +
                    (String(opt.value) === String(ctx.current) ? ' is-active' : '');
                row.textContent = opt.label;
                row.addEventListener('click', () => {
                    this.updateCondition(ctx.id, ctx.prop, opt.value);
                    this._closePicker();
                });
                list.appendChild(row);
                count++;
            }
            if (count === 0) {
                const empty = document.createElement('div');
                empty.className = 'eds-empty';
                empty.textContent = 'No matches.';
                list.appendChild(empty);
            }
        };
        renderRows();

        if (searchInput) {
            searchInput.addEventListener('input', () =>
                renderRows(searchInput.value.toLowerCase().trim()));
        }

        document.body.appendChild(pop);
        this._popover = pop;
        this._popoverBtn = btn;
        btn.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');

        this._positionPopover();

        // Auto-scroll the active option into view, then focus search if present
        const active = list.querySelector('.eds-option.is-active');
        active?.scrollIntoView({ block: 'nearest' });
        if (searchInput) setTimeout(() => searchInput.focus(), 0);

        // Outside click / esc / scroll handlers
        const onDocPointer = (e) => {
            if (!pop.contains(e.target) && !btn.contains(e.target)) this._closePicker();
        };
        const onKey = (e) => { if (e.key === 'Escape') this._closePicker(); };
        const onResize = () => this._positionPopover();
        const modalBody = this.elements.modal?.querySelector('.modal-body');
        const onScroll = () => this._closePicker();

        // Defer attaching the outside-click so the opening click doesn't immediately close it
        setTimeout(() => {
            document.addEventListener('mousedown', onDocPointer, true);
            document.addEventListener('keydown', onKey);
            window.addEventListener('resize', onResize);
            modalBody?.addEventListener('scroll', onScroll, true);
        }, 0);

        this._popoverHandlers = { onDocPointer, onKey, onResize, onScroll, modalBody };
    }

    _positionPopover() {
        const pop = this._popover, btn = this._popoverBtn;
        if (!pop || !btn) return;
        pop.style.position = 'fixed';
        pop.style.visibility = 'hidden';
        pop.style.left = '0px';
        pop.style.top = '0px';

        const rect = btn.getBoundingClientRect();
        const minW = Math.max(rect.width, 200);
        pop.style.minWidth = `${minW}px`;
        pop.style.maxWidth = '360px';
        pop.style.maxHeight = '320px';

        const popRect = pop.getBoundingClientRect();
        let top  = rect.bottom + 4;
        let left = rect.left;

        // Flip up if it would overflow the viewport bottom
        if (top + popRect.height > window.innerHeight - 8) {
            const flippedTop = rect.top - popRect.height - 4;
            if (flippedTop >= 8) top = flippedTop;
            else top = Math.max(8, window.innerHeight - popRect.height - 8);
        }
        if (left + popRect.width > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - popRect.width - 8);
        }
        if (left < 8) left = 8;

        pop.style.left = `${left}px`;
        pop.style.top  = `${top}px`;
        pop.style.visibility = '';
    }

    _closePicker() {
        const h = this._popoverHandlers;
        if (h) {
            document.removeEventListener('mousedown', h.onDocPointer, true);
            document.removeEventListener('keydown',   h.onKey);
            window.removeEventListener('resize',      h.onResize);
            h.modalBody?.removeEventListener('scroll', h.onScroll, true);
        }
        this._popoverHandlers = null;
        if (this._popoverBtn) {
            this._popoverBtn.classList.remove('is-open');
            this._popoverBtn.setAttribute('aria-expanded', 'false');
        }
        if (this._popover?.parentNode) {
            this._popover.parentNode.removeChild(this._popover);
        }
        this._popover = null;
        this._popoverBtn = null;
    }

    renderGroup(group, index) {
        const el = document.createElement('div');
        el.className = 'query-group';
        el.dataset.id = group.id;

        el.innerHTML = `
            <div class="query-group-header">
                ${index > 0
                    ? `<div class="condition-logic">${this._buttonHtml({
                            prop: 'logic', id: group.id, value: group.logic,
                            label: group.logic, variant: 'logic'
                        })}</div>`
                    : ''}
                <span class="query-group-label">( group )</span>
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

        el.querySelector('.query-group-header .eds-btn')?.addEventListener('click', e => {
            e.stopPropagation();
            this._openPicker(e.currentTarget);
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
