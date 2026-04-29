/**
 * FilterByChart — chart-driven filter UI for the Filters tab.
 *
 * One picker, one figure: numeric variables show a dual-thumb range slider;
 * categorical / binary / name show clickable bars or a searchable list.
 * Active filters are listed below as a typeset register.
 *
 * Reads:  unfiltered base records (snapshot from first data:loaded) for the
 *         distribution; live numeric range state from NumericRangeFilters.
 * Owns:   multi-select sets per categorical filterKey. Emits 'filterByChart:apply'
 *         on every mutation; main.js applies the full client-side pipeline
 *         (multi-selections + ranges + SQL) and updates map/stats.
 * Writes: numeric ranges via NumericRangeFilters.setRange (brush handle drop).
 */

import { fmtNum } from '../utils/stats.js';

// Variable registry — the union of categorical filter keys and numeric range keys.
const FIELDS = [
    // Identity
    { key: 'name_en',          label: 'Name',                type: 'name',        filterKey: 'name',     group: 'Identity' },
    { key: 'location_en',      label: 'Location',            type: 'categorical', filterKey: 'location', group: 'Identity' },
    { key: 'island_en',        label: 'Island',              type: 'categorical', filterKey: 'island',   group: 'Identity' },

    // Morphometry
    { key: 'area_km2',         label: 'Area',                type: 'numeric', unit: 'km²', rangeKey: 'area_km2',      group: 'Morphometry' },
    { key: 'perimeter_km2',    label: 'Perimeter',           type: 'numeric', unit: 'km',  rangeKey: 'perimeter_km2', group: 'Morphometry' },
    { key: 'length_m',         label: 'Length',              type: 'numeric', unit: 'm',   rangeKey: 'length_m',      group: 'Morphometry' },
    { key: 'width_m',          label: 'Width',               type: 'numeric', unit: 'm',   rangeKey: 'width_m',       group: 'Morphometry' },
    { key: 'height_m',         label: 'Sandspit Max Height', type: 'numeric', unit: 'm',   rangeKey: 'height_m',      group: 'Morphometry' },

    // SSP1-2.6
    { key: 'rcp2_6_inundated', label: 'Inundated',           type: 'binary',  filterKey: 'rcp2_6_inundated', group: 'SSP1-2.6 (low emissions)' },
    { key: 'rcp2_6_slr',       label: 'SLR (geocentric)',    type: 'numeric', unit: 'm', rangeKey: 'rcp2_6_slr',     group: 'SSP1-2.6 (low emissions)' },
    { key: 'rcp2_6_vec_slr',   label: 'SLR (VLM-corrected)', type: 'numeric', unit: 'm', rangeKey: 'rcp2_6_vec_slr', group: 'SSP1-2.6 (low emissions)' },

    // SSP5-8.5
    { key: 'rcp8_5_inundated', label: 'Inundated',           type: 'binary',  filterKey: 'rcp8_5_inundated', group: 'SSP5-8.5 (high emissions)' },
    { key: 'rcp8_5_slr',       label: 'SLR (geocentric)',    type: 'numeric', unit: 'm', rangeKey: 'rcp8_5_slr',     group: 'SSP5-8.5 (high emissions)' },
    { key: 'rcp8_5_vec_slr',   label: 'SLR (VLM-corrected)', type: 'numeric', unit: 'm', rangeKey: 'rcp8_5_vec_slr', group: 'SSP5-8.5 (high emissions)' }
];

const FIELD_BY_KEY = new Map(FIELDS.map(f => [f.key, f]));
const FIELD_BY_FILTERKEY = new Map(FIELDS.filter(f => f.filterKey).map(f => [f.filterKey, f]));
const FIELD_BY_RANGEKEY  = new Map(FIELDS.filter(f => f.rangeKey ).map(f => [f.rangeKey,  f]));

export default class FilterByChart {
    constructor(eventBus, stateManager, dataManager, filterManager, numericRangeFilters) {
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.dataManager = dataManager;
        this.filterManager = filterManager;
        this.numericRangeFilters = numericRangeFilters;

        this.fields = [...FIELDS];
        this.selectedKey = 'name_en';
        this.allRecords = null;       // base distribution (snapshot)

        // Multi-select state: one Set<string> of values per categorical filterKey.
        // FilterByChart owns this; main.js's 'filterByChart:apply' handler
        // computes filtered data client-side from allRecords using these.
        this.selections = {
            name:               new Set(),
            location:           new Set(),
            island:             new Set(),
            rcp2_6_inundated:   new Set(),
            rcp8_5_inundated:   new Set()
        };
        this._suppressCommit = false;   // re-entrancy guard
    }

    /** Public read of the current multi-selection sets (for main.js). */
    getSelections() { return this.selections; }

    /** Map a filterKey (e.g. 'island') to the data column ('island_en'). */
    getDataFieldForFilterKey(filterKey) {
        const f = FIELD_BY_FILTERKEY.get(filterKey);
        return f ? f.key : filterKey;
    }

    // ─── multi-select state mutators ────────────────────────────────────────
    toggleSelection(filterKey, value) {
        const set = this.selections[filterKey];
        if (!set) return;
        const v = String(value);
        if (set.has(v)) set.delete(v); else set.add(v);
        this.commit();
    }

    removeSelection(filterKey, value) {
        const set = this.selections[filterKey];
        if (!set) return;
        if (set.delete(String(value))) this.commit();
    }

    clearList(filterKey) {
        const set = this.selections[filterKey];
        if (!set || set.size === 0) return;
        set.clear();
        this.commit();
    }

    /** Reset all categorical multi-selections AND numeric ranges. */
    clearAllFilters() {
        let mutated = false;
        for (const set of Object.values(this.selections)) {
            if (set.size > 0) { set.clear(); mutated = true; }
        }
        // numeric ranges
        const ranges = this.numericRangeFilters.getActiveRanges?.() || {};
        if (Object.keys(ranges).length > 0) {
            this._suppressCommit = true;
            this.numericRangeFilters.clearAll?.();
            this._suppressCommit = false;
            mutated = true;
        }
        // SQL
        const sql = this.stateManager.get('activeSqlFilter');
        if (sql && sql.length) {
            this.eventBus.emit('sqlFilter:clear');
            mutated = true;
        }
        // Always commit so map/stats refresh even if nothing was active
        this.commit();
    }

    /** Recompute and notify orchestrator. main.js handles 'filterByChart:apply'. */
    commit() {
        if (this._suppressCommit) return;
        this.eventBus.emit('filterByChart:apply', {
            selections: this.snapshotSelections(),
            ranges: this.numericRangeFilters.getActiveRanges?.() || {}
        });
        // UI re-render is driven by data:loaded the orchestrator will emit.
    }

    snapshotSelections() {
        const out = {};
        for (const [k, set] of Object.entries(this.selections)) out[k] = [...set];
        return out;
    }

    init() {
        this.cacheElements();
        if (!this.el.tab) return;
        this.bindEvents();
        this.populatePickerList();
        this.render();
        if (window.DEBUG_MODE) console.log('✅ FilterByChart: Initialized');
    }

    cacheElements() {
        this.el = {
            tab:           document.getElementById('filters-tab'),
            pickerBtn:     document.getElementById('fbc-picker-btn'),
            pickerValue:   document.getElementById('fbc-picker-value'),
            content:       document.getElementById('fbc-content'),
            activeSection: document.getElementById('fbc-active-section'),
            activeList:    document.getElementById('fbc-active-list'),
            modal:         document.getElementById('fbc-variable-modal'),
            modalClose:    document.getElementById('close-fbc-variable'),
            modalSearch:   document.getElementById('fbc-variable-search-input'),
            modalList:     document.getElementById('fbc-variable-list')
        };
        // Per-variable search term cache so it survives re-renders
        this._listSearch = this._listSearch || new Map();
    }

    bindEvents() {
        this.el.pickerBtn?.addEventListener('click', () => this.openPicker());
        this.el.modalClose?.addEventListener('click', () => this.closePicker());
        this.el.modal?.addEventListener('click', (e) => {
            if (e.target === this.el.modal) this.closePicker();
        });

        // Take ownership of the global Reset all button. We replace the existing
        // listener (FilterManager binds in its init, which runs before us) by
        // cloning so this single handler resets categorical + ranges + SQL.
        const oldClear = document.getElementById('clear-filters');
        if (oldClear && oldClear.parentNode) {
            const fresh = oldClear.cloneNode(true);
            oldClear.parentNode.replaceChild(fresh, oldClear);
            fresh.addEventListener('click', () => this.clearAllFilters());
        }
        let frame = null;
        this.el.modalSearch?.addEventListener('input', () => {
            if (frame) cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => this.populatePickerList());
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.el.modal?.classList.contains('active')) {
                this.closePicker();
            }
        });

        // Snapshot the base distribution on the first data:loaded with no filters,
        // and re-render whenever data/filters change so highlighting stays in sync.
        this.eventBus.on('data:loaded', () => {
            if (!this.allRecords) {
                const f = this.filterManager.getActiveFilters?.() || {};
                const r = this.numericRangeFilters.getActiveRanges?.() || {};
                const noFilters = Object.values(f).every(v => !v) && Object.keys(r).length === 0;
                if (noFilters) {
                    const cur = this.stateManager.get('currentData') || [];
                    this.allRecords = [...cur];
                }
            }
            this.render();
        });
        // After any pipeline run, refresh the chart highlighting + active list.
        // (main.js owns the actual data application; we only re-render UI here.)
        this.eventBus.on('numericRanges:changed', () => this.render());
        this.eventBus.on('filters:apply',         () => this.render());
        this.eventBus.on('sqlFilter:applied',     () => this.render());
        this.eventBus.on('sqlFilter:cleared',     () => this.render());

        this.eventBus.on('ui:tabChanged', ({ tab }) => {
            if (tab === 'filters') this.render();
        });

        let resizeFrame = null;
        window.addEventListener('resize', () => {
            if (resizeFrame) cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(() => this.render());
        });
    }

    // ─── picker modal ───────────────────────────────────────────────────────
    populatePickerList() {
        const list = this.el.modalList;
        if (!list) return;
        list.replaceChildren();

        const grouped = new Map();
        for (const f of this.fields) {
            const g = f.group || 'Other';
            if (!grouped.has(g)) grouped.set(g, []);
            grouped.get(g).push(f);
        }

        const term = (this.el.modalSearch?.value || '').toLowerCase().trim();

        let any = false;
        for (const [groupLabel, items] of grouped) {
            const filtered = term
                ? items.filter(f =>
                    f.label.toLowerCase().includes(term) ||
                    (f.unit || '').toLowerCase().includes(term))
                : items;
            if (filtered.length === 0) continue;
            any = true;

            const heading = document.createElement('div');
            heading.className = 'stats-variable-group';
            heading.textContent = groupLabel;
            list.appendChild(heading);

            for (const f of filtered) {
                const row = document.createElement('div');
                row.className = 'filter-modal-option stats-variable-option' +
                    (f.key === this.selectedKey ? ' selected-current' : '');
                row.dataset.value = f.key;

                const main = document.createElement('span');
                main.className = 'stats-variable-main';
                main.textContent = f.unit ? `${f.label} (${f.unit})` : f.label;

                const type = document.createElement('span');
                type.className = `stats-variable-type is-${f.type}`;
                type.textContent = f.type === 'name' ? 'list' : f.type;

                row.append(main, type);
                row.addEventListener('click', () => this.selectField(f.key));
                list.appendChild(row);
            }
        }

        if (!any) {
            const empty = document.createElement('div');
            empty.className = 'filter-modal-no-results';
            empty.textContent = 'No matching variables';
            list.appendChild(empty);
        }
    }

    openPicker() {
        if (!this.el.modal) return;
        if (this.el.modalSearch) this.el.modalSearch.value = '';
        this.populatePickerList();
        this.el.modal.classList.add('active');
        document.body.classList.add('modal-open');
        setTimeout(() => this.el.modalSearch?.focus(), 80);
    }

    closePicker() {
        if (!this.el.modal) return;
        this.el.modal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }

    selectField(key) {
        if (!FIELD_BY_KEY.has(key)) return;
        this.selectedKey = key;
        this.closePicker();
        this.render();
    }

    // ─── render orchestration ───────────────────────────────────────────────
    getField() { return FIELD_BY_KEY.get(this.selectedKey) || this.fields[0]; }

    getBase() {
        // Prefer snapshot; fall back to currentData if snapshot not yet captured.
        return this.allRecords && this.allRecords.length
            ? this.allRecords
            : (this.stateManager.get('currentData') || []);
    }

    render() {
        if (!this.el.tab || !this.el.content) return;
        const field = this.getField();
        this.updatePickerButton(field);
        this.renderActiveList();

        // Clear previous content
        this.el.content.replaceChildren();

        const records = this.getBase();
        if (!records.length) {
            this.renderEmpty('Loading data…');
            return;
        }

        if (field.type === 'numeric') this.renderNumeric(field, records);
        else                          this.renderListView(field, records);
    }

    updatePickerButton(field) {
        if (this.el.pickerValue) {
            this.el.pickerValue.textContent = field.unit ? `${field.label} (${field.unit})` : field.label;
        }
    }

    renderEmpty(msg) {
        if (!this.el.content) return;
        const d = document.createElement('div');
        d.className = 'fbc-empty';
        d.textContent = msg;
        this.el.content.replaceChildren(d);
    }

    // ─── NUMERIC: dual-thumb range slider ───────────────────────────────────
    renderNumeric(field, records) {
        const state = this.numericRangeFilters.getFieldState?.(field.rangeKey);
        if (!state) {
            // bounds may not be ready on the very first render; show nothing
            // and re-render once data loads.
            this.renderEmpty('Loading…');
            return;
        }
        const { min, max, lo, hi } = state;

        // Pick a log scale for highly skewed positive ranges (e.g., area).
        const useLog = (min > 0) && (max / min > 100);
        const STEPS = 1000;
        const project   = useLog ? Math.log10              : (v => v);
        const unproject = useLog ? (x => Math.pow(10, x))  : (x => x);
        const minP = project(min);
        const maxP = project(max);
        const span = (maxP - minP) || 1;
        const valueToStep = v => Math.round(((project(Math.max(min, Math.min(max, v))) - minP) / span) * STEPS);
        const stepToValue = s => unproject(minP + (s / STEPS) * span);

        const wrap = document.createElement('div');
        wrap.className = 'fbc-slider';

        const trackWrap = document.createElement('div');
        trackWrap.className = 'fbc-slider-track-wrap';

        const track = document.createElement('div');
        track.className = 'fbc-slider-track';
        const fill = document.createElement('div');
        fill.className = 'fbc-slider-fill';
        track.appendChild(fill);
        trackWrap.appendChild(track);

        const inLo = document.createElement('input');
        inLo.type = 'range'; inLo.className = 'fbc-slider-input fbc-slider-lo';
        inLo.min = '0'; inLo.max = String(STEPS); inLo.step = '1';
        inLo.value = String(valueToStep(lo));
        inLo.setAttribute('aria-label', `Minimum ${field.label}`);

        const inHi = document.createElement('input');
        inHi.type = 'range'; inHi.className = 'fbc-slider-input fbc-slider-hi';
        inHi.min = '0'; inHi.max = String(STEPS); inHi.step = '1';
        inHi.value = String(valueToStep(hi));
        inHi.setAttribute('aria-label', `Maximum ${field.label}`);

        trackWrap.append(inLo, inHi);

        const ends = document.createElement('div');
        ends.className = 'fbc-slider-ends';
        const u = field.unit ? ` ${field.unit}` : '';
        const loLbl = document.createElement('span');
        loLbl.className = 'fbc-slider-end fbc-slider-end-lo';
        const hiLbl = document.createElement('span');
        hiLbl.className = 'fbc-slider-end fbc-slider-end-hi';
        ends.append(loLbl, hiLbl);

        wrap.append(trackWrap, ends);

        this.el.content?.appendChild(wrap);

        let curLo = lo, curHi = hi;

        const updateLabels = () => {
            loLbl.textContent = `${fmtNum(curLo)}${u}`;
            hiLbl.textContent = `${fmtNum(curHi)}${u}`;
        };
        const updateFill = () => {
            const lp = (parseInt(inLo.value, 10) / STEPS) * 100;
            const hp = (parseInt(inHi.value, 10) / STEPS) * 100;
            fill.style.left  = `${Math.min(lp, hp)}%`;
            fill.style.right = `${100 - Math.max(lp, hp)}%`;
        };
        const onInput = () => {
            let lv = parseInt(inLo.value, 10);
            let hv = parseInt(inHi.value, 10);
            if (lv > hv) { [lv, hv] = [hv, lv]; }
            curLo = stepToValue(lv);
            curHi = stepToValue(hv);
            updateFill();
            updateLabels();
        };
        const onChange = () => {
            const eps = span * 1e-6;
            const isMin = (project(curLo) - minP) <= eps;
            const isMax = (maxP - project(curHi)) <= eps;
            this.numericRangeFilters.setRange?.(
                field.rangeKey,
                isMin ? null : curLo,
                isMax ? null : curHi
            );
        };
        inLo.addEventListener('input', onInput);
        inHi.addEventListener('input', onInput);
        inLo.addEventListener('change', onChange);
        inHi.addEventListener('change', onChange);

        updateFill();
        updateLabels();
    }

    // ─── UNIFIED LIST VIEW: search + scrollable rows + click to multi-select ─
    /**
     * Renders any non-numeric variable as a searchable, scrollable list.
     * Each row: label · mini count-bar · count. Click toggles selection.
     * Used for binary (yes/no), categorical (location, island), and name.
     */
    renderListView(field, records) {
        const filterKey = field.filterKey;
        const dataField = field.key;
        const set = this.selections[filterKey] || new Set();

        // Tally counts per unique value
        const counts = new Map();
        for (const r of records) {
            const v = r?.[dataField];
            if (v == null || v === '') continue;
            const k = String(v);
            counts.set(k, (counts.get(k) || 0) + 1);
        }
        if (counts.size === 0) {
            this.renderEmpty('No data available.');
            return;
        }

        // Items as { value, count, sub? }; "sub" only meaningful for Name
        const subs = new Map();
        if (field.type === 'name') {
            for (const r of records) {
                const v = r?.name_en;
                if (!v || subs.has(v)) continue;
                subs.set(String(v), r?.location_en || '');
            }
        }

        // Sort: selected first; then by count desc; ties broken alphabetically.
        // For names where count is uniformly 1, this collapses to alphabetical.
        const items = [...counts.entries()].map(([value, count]) => ({
            value, count, sub: subs.get(value) || ''
        }));
        const sortByCount = items.some(it => it.count !== items[0].count);
        items.sort((a, b) => {
            const aSel = set.has(a.value) ? 0 : 1;
            const bSel = set.has(b.value) ? 0 : 1;
            if (aSel !== bSel) return aSel - bSel;
            if (sortByCount && a.count !== b.count) return b.count - a.count;
            return a.value.localeCompare(b.value);
        });
        const maxCount = items.reduce((m, it) => Math.max(m, it.count), 1);

        // ───── DOM ─────
        const wrap = document.createElement('div');
        wrap.className = 'fbc-list';

        // Search input — only shown when worth it (>8 entries)
        const showSearch = items.length > 8;
        let search = null;
        if (showSearch) {
            search = document.createElement('input');
            search.type = 'text';
            search.className = 'fbc-list-search';
            search.placeholder = `Search ${field.label.toLowerCase()}…`;
            search.autocomplete = 'off';
            search.value = this._listSearch.get(filterKey) || '';
            search.addEventListener('input', () => {
                this._listSearch.set(filterKey, search.value);
                applyFilter();
            });
            wrap.appendChild(search);
        }

        const rows = document.createElement('div');
        rows.className = 'fbc-list-rows';
        wrap.appendChild(rows);

        const buildRow = (item) => {
            const isActive = set.has(item.value);
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'fbc-list-row' + (isActive ? ' is-active' : '');
            row.title = item.value;

            const lbl = document.createElement('span');
            lbl.className = 'fbc-list-label';
            lbl.textContent = item.value;

            const count = document.createElement('span');
            count.className = 'fbc-list-count';
            count.textContent = String(item.count);

            const tick = document.createElement('span');
            tick.className = 'fbc-list-tick';
            tick.setAttribute('aria-hidden', 'true');
            tick.textContent = isActive ? '✓' : '';

            row.append(lbl, count, tick);

            // Optional Name location subtext
            if (field.type === 'name' && item.sub) {
                lbl.title = `${item.value} · ${item.sub}`;
                const sub = document.createElement('span');
                sub.className = 'fbc-list-sub';
                sub.textContent = item.sub;
                lbl.appendChild(document.createTextNode(' '));
                lbl.appendChild(sub);
            }

            row.addEventListener('click', () => this.toggleSelection(filterKey, item.value));
            return row;
        };

        const applyFilter = () => {
            const term = (search?.value || '').toLowerCase().trim();
            const filtered = term
                ? items.filter(it =>
                    it.value.toLowerCase().includes(term) ||
                    (it.sub && it.sub.toLowerCase().includes(term)))
                : items;
            rows.replaceChildren();
            if (filtered.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'fbc-list-empty';
                empty.textContent = 'No matches.';
                rows.appendChild(empty);
                return;
            }
            const frag = document.createDocumentFragment();
            for (const it of filtered) frag.appendChild(buildRow(it));
            rows.appendChild(frag);
        };
        applyFilter();

        this.el.content?.appendChild(wrap);
    }


    // ─── ACTIVE FILTERS REGISTER (compact pills + overflow popover) ─────────
    /**
     * Builds the canonical list of active filter items from selections + ranges.
     * Each item: { fieldKey, label, valueText, onClear }
     */
    _collectActiveItems() {
        const ranges = this.numericRangeFilters.getActiveRanges?.() || {};
        const items = [];

        for (const [filterKey, set] of Object.entries(this.selections)) {
            if (!set || set.size === 0) continue;
            const f = FIELD_BY_FILTERKEY.get(filterKey);
            if (!f) continue;
            for (const value of set) {
                items.push({
                    fieldKey: f.key,
                    label: f.label + (f.group?.includes('SSP') ? ` · ${f.group.split(' ')[0]}` : ''),
                    valueText: f.type === 'binary' ? labelizeYesNo(value) : String(value),
                    onClear: () => this.removeSelection(filterKey, value)
                });
            }
        }
        for (const [rangeKey, { min, max }] of Object.entries(ranges)) {
            const f = FIELD_BY_RANGEKEY.get(rangeKey);
            if (!f) continue;
            const u = f.unit ? ` ${f.unit}` : '';
            items.push({
                fieldKey: f.key,
                label: `${f.label}${f.group?.includes('SSP') ? ` · ${f.group.split(' ')[0]}` : ''}`,
                valueText: `${fmtNum(min)} – ${fmtNum(max)}${u}`,
                onClear: () => this.numericRangeFilters.resetField?.(rangeKey)
            });
        }
        return items;
    }

    renderActiveList() {
        if (!this.el.activeList || !this.el.activeSection) return;

        const items = this._collectActiveItems();
        this._activeItems = items;

        if (items.length === 0) {
            this.el.activeSection.classList.add('hidden');
            this.el.activeList.replaceChildren();
            this._closePopover();
            return;
        }
        this.el.activeSection.classList.remove('hidden');

        // Render every chip; overflow truncation happens after layout (rAF).
        const frag = document.createDocumentFragment();
        for (const item of items) frag.appendChild(this._buildChip(item));
        this.el.activeList.replaceChildren(frag);
        this._activeChipEls = Array.from(this.el.activeList.children);

        // Defer measurement until layout settles
        if (this._truncateRaf) cancelAnimationFrame(this._truncateRaf);
        this._truncateRaf = requestAnimationFrame(() => this._truncateChips());

        // If popover is open, refresh its content with the new items
        if (this._popover) this._renderPopoverContent();
    }

    _buildChip(item) {
        const chip = document.createElement('span');
        chip.className = 'fbc-chip';
        chip.title = `${item.label}: ${item.valueText}`;

        const text = document.createElement('span');
        text.className = 'fbc-chip-text';
        text.textContent = `${item.label}: ${item.valueText}`;

        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'fbc-chip-x';
        x.setAttribute('aria-label', `Clear ${item.label}`);
        x.textContent = '×';
        x.addEventListener('click', (e) => {
            e.stopPropagation();
            item.onClear();
        });

        // Click body of chip → switch picker to that variable
        const text2 = text;
        text2.addEventListener('click', () => this.selectField(item.fieldKey));
        text2.style.cursor = 'pointer';

        chip.append(text, x);
        return chip;
    }

    /**
     * After all chips are rendered, hide those that wrap to a third+ line and
     * show a "+N more" trigger that opens the floating popover.
     */
    _truncateChips() {
        const list = this.el.activeList;
        const chips = this._activeChipEls;
        if (!list || !chips || chips.length === 0) return;

        // Reset state: show all, remove any prior "more" trigger
        chips.forEach(c => { c.style.display = ''; });
        list.querySelector('.fbc-chip-more')?.remove();

        // Group chips by line via their offsetTop
        const tops = chips.map(c => c.offsetTop);
        const lines = [];
        for (let i = 0; i < tops.length; i++) {
            const last = lines[lines.length - 1];
            if (!last || tops[i] !== last.top) lines.push({ top: tops[i], start: i });
        }

        const MAX_LINES = 2;
        if (lines.length <= MAX_LINES) return; // everything fits

        // Hide everything from the start of line MAX_LINES onward
        let cutoff = lines[MAX_LINES].start;

        // Reserve room for the "+N more" pill on the last visible line.
        // Insert a placeholder, measure, and back off if needed.
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'fbc-chip-more';
        more.addEventListener('click', (e) => {
            e.stopPropagation();
            this._openActivePopover(e.currentTarget);
        });

        const setMoreText = (n) => { more.textContent = `+${n} more`; };
        setMoreText(chips.length - cutoff);
        list.appendChild(more);

        // Hide chips at and beyond cutoff
        const apply = () => {
            chips.forEach((c, i) => { c.style.display = i >= cutoff ? 'none' : ''; });
            setMoreText(chips.length - cutoff);
        };
        apply();

        // If "+more" itself has spilled past line 2, retreat one more chip at a time
        let safety = chips.length;
        while (safety-- > 0) {
            const moreTop = more.offsetTop;
            // The acceptable max top is the second line's offset
            const maxAcceptableTop = lines[1].top;
            if (moreTop <= maxAcceptableTop) break;
            cutoff--;
            if (cutoff <= 0) break;
            apply();
        }
    }

    // ─── floating popover ────────────────────────────────────────────────────
    _openActivePopover(trigger) {
        this._closePopover();

        const pop = document.createElement('div');
        pop.className = 'fbc-active-popover';
        pop.role = 'dialog';
        pop.setAttribute('aria-label', 'Active filters');

        document.body.appendChild(pop);
        this._popover = pop;
        this._popoverTrigger = trigger;
        this._renderPopoverContent();
        this._positionPopover();

        // Outside click closes (deferred so the opening click doesn't immediately close)
        const onDocDown = (e) => {
            if (!pop.contains(e.target) && e.target !== trigger) this._closePopover();
        };
        const onKey = (e) => { if (e.key === 'Escape') this._closePopover(); };
        const onResize = () => this._positionPopover();

        setTimeout(() => document.addEventListener('mousedown', onDocDown), 0);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', onResize);
        window.addEventListener('scroll', onResize, true);

        this._popoverTeardown = () => {
            document.removeEventListener('mousedown', onDocDown);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', onResize);
            window.removeEventListener('scroll', onResize, true);
        };
    }

    _renderPopoverContent() {
        const pop = this._popover;
        if (!pop) return;
        const items = this._activeItems || [];
        if (items.length === 0) {
            this._closePopover();
            return;
        }

        pop.replaceChildren();

        const head = document.createElement('div');
        head.className = 'fbc-popover-head';
        const title = document.createElement('span');
        title.className = 'fbc-popover-title';
        title.textContent = `Active filters · ${items.length}`;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'fbc-popover-close';
        close.setAttribute('aria-label', 'Close');
        close.textContent = '×';
        close.addEventListener('click', () => this._closePopover());
        head.append(title, close);
        pop.appendChild(head);

        const list = document.createElement('div');
        list.className = 'fbc-popover-list';
        for (const item of items) {
            const row = document.createElement('div');
            row.className = 'fbc-popover-row';
            const main = document.createElement('button');
            main.type = 'button';
            main.className = 'fbc-popover-main';
            const lbl = document.createElement('span');
            lbl.className = 'fbc-popover-label';
            lbl.textContent = item.label;
            const val = document.createElement('span');
            val.className = 'fbc-popover-value';
            val.textContent = item.valueText;
            main.append(lbl, val);
            main.addEventListener('click', () => {
                this.selectField(item.fieldKey);
                this._closePopover();
            });
            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'fbc-popover-x';
            x.setAttribute('aria-label', `Clear ${item.label}`);
            x.textContent = '×';
            x.addEventListener('click', (e) => {
                e.stopPropagation();
                item.onClear();
                // render() will repopulate; popover content auto-refreshes there
            });
            row.append(main, x);
            list.appendChild(row);
        }
        pop.appendChild(list);

        const foot = document.createElement('div');
        foot.className = 'fbc-popover-foot';
        const clearAll = document.createElement('button');
        clearAll.type = 'button';
        clearAll.className = 'fbc-popover-clearall';
        clearAll.textContent = 'Clear all';
        clearAll.addEventListener('click', () => {
            this.clearAllFilters();
            this._closePopover();
        });
        foot.appendChild(clearAll);
        pop.appendChild(foot);

        // Re-position once content is in place
        this._positionPopover();
    }

    _positionPopover() {
        const pop = this._popover;
        const trigger = this._popoverTrigger;
        if (!pop || !trigger) return;

        const tr = trigger.getBoundingClientRect();
        const ph = pop.offsetHeight;
        const pw = pop.offsetWidth;
        const margin = 8;

        // Prefer above the trigger; fall back to below if not enough room
        let top = tr.top - ph - margin;
        if (top < margin) top = tr.bottom + margin;
        // Anchor to the trigger's right edge
        let left = tr.right - pw;
        if (left < margin) left = margin;
        if (left + pw > window.innerWidth - margin) {
            left = window.innerWidth - pw - margin;
        }

        pop.style.top  = `${Math.max(margin, top)}px`;
        pop.style.left = `${left}px`;
    }

    _closePopover() {
        if (this._popoverTeardown) { this._popoverTeardown(); this._popoverTeardown = null; }
        if (this._popover) { this._popover.remove(); this._popover = null; }
        this._popoverTrigger = null;
    }

}

function labelizeYesNo(v) {
    const s = String(v ?? '').toLowerCase();
    if (s === 'yes') return 'Inundated';
    if (s === 'no')  return 'Not inundated';
    return String(v);
}

export { FIELDS as FILTER_BY_CHART_FIELDS };
