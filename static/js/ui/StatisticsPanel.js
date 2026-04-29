/**
 * StatisticsPanel - field selector + journal-grade SVG viz
 *
 * Reads `currentData` (filtered marker records) from StateManager, recomputes
 * descriptive statistics whenever filters change, and renders into #statistics-tab.
 *
 * Uses DOM construction (no innerHTML for dynamic data).
 */

import {
    toNumeric, numericSummary, histogram, frequencyTable, fmtNum, fmtInt, logTicks
} from '../utils/stats.js';

const LOG_SKEW_THRESHOLD = 1.5;

const FIELDS = [
    // Morphometrics
    { key: 'area_km2',             label: 'Area',                type: 'numeric', unit: 'km²', group: 'Morphometry' },
    { key: 'perimeter_km2',        label: 'Perimeter',           type: 'numeric', unit: 'km',  group: 'Morphometry' },
    { key: 'length_m',             label: 'Length',              type: 'numeric', unit: 'm',   group: 'Morphometry' },
    { key: 'width_m',              label: 'Width',               type: 'numeric', unit: 'm',   group: 'Morphometry' },
    { key: 'height_m',             label: 'Sandspit Max Height', type: 'numeric', unit: 'm',   group: 'Morphometry' },

    // Geography
    { key: 'island_en',            label: 'Island',                type: 'categorical', group: 'Geography' },
    { key: 'location_en',          label: 'Location (Prefecture)', type: 'categorical', group: 'Geography' },

    // SSP1-2.6 — show the two real columns side by side
    { key: 'rcp2_6_slr',           label: 'SLR (geocentric)',    type: 'numeric',     unit: 'm', group: 'SSP1-2.6 (low emissions)' },
    { key: 'rcp2_6_vec_slr',       label: 'SLR (VLM-corrected)', type: 'numeric',     unit: 'm', group: 'SSP1-2.6 (low emissions)' },
    { key: 'rcp2_6_inundated',     label: 'Inundated (geocentric)',    type: 'categorical', group: 'SSP1-2.6 (low emissions)' },
    { key: 'rcp2_6_vec_inundated', label: 'Inundated (VLM-corrected)', type: 'categorical', group: 'SSP1-2.6 (low emissions)' },

    // SSP5-8.5 — same shape
    { key: 'rcp8_5_slr',           label: 'SLR (geocentric)',    type: 'numeric',     unit: 'm', group: 'SSP5-8.5 (high emissions)' },
    { key: 'rcp8_5_vec_slr',       label: 'SLR (VLM-corrected)', type: 'numeric',     unit: 'm', group: 'SSP5-8.5 (high emissions)' },
    { key: 'rcp8_5_inundated',     label: 'Inundated (geocentric)',    type: 'categorical', group: 'SSP5-8.5 (high emissions)' },
    { key: 'rcp8_5_vec_inundated', label: 'Inundated (VLM-corrected)', type: 'categorical', group: 'SSP5-8.5 (high emissions)' }
];

const SVG_NS = 'http://www.w3.org/2000/svg';

export default class StatisticsPanel {
    constructor(eventBus, stateManager, mapManager) {
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.mapManager = mapManager;
        this.fields = [...FIELDS];
        this.selectedKey = this.fields[0].key;
        this.activeTooltip = null;
    }

    init() {
        this.cacheElements();
        if (!this.el.tab) {
            if (window.DEBUG_MODE) console.warn('StatisticsPanel: #statistics-tab not found');
            return;
        }
        this.populateFieldSelector();
        this.bindEvents();
        this.render();
        if (window.DEBUG_MODE) console.log('✅ StatisticsPanel: Initialized');
    }

    /**
     * Allow main.js to extend the field list when more data fields become available.
     */
    setFields(fields) {
        if (!Array.isArray(fields) || fields.length === 0) return;
        this.fields = fields;
        if (!this.fields.find(f => f.key === this.selectedKey)) {
            this.selectedKey = this.fields[0].key;
        }
        this.populateFieldSelector();
        this.render();
    }

    cacheElements() {
        this.el = {
            tab:           document.getElementById('statistics-tab'),
            fieldBtn:      document.getElementById('stats-field-btn'),
            fieldBtnValue: document.getElementById('stats-field-btn-value'),
            typeBadge:     document.getElementById('stats-type-badge'),
            chartWrap:     document.getElementById('stats-chart-wrap'),
            axisLabel:     document.getElementById('stats-axis-label'),
            summary:       document.getElementById('stats-summary'),
            figTitle:      document.getElementById('stats-figure-title'),
            modal:         document.getElementById('stats-variable-modal'),
            modalClose:    document.getElementById('close-stats-variable'),
            modalList:     document.getElementById('stats-variable-list'),
            modalSearch:   document.getElementById('stats-variable-search-input'),
            // Bin/category drill-down modal
            binModal:      document.getElementById('stats-bin-modal'),
            binModalClose: document.getElementById('close-stats-bin'),
            binModalTitle: document.getElementById('stats-bin-modal-title'),
            binModalList:  document.getElementById('stats-bin-list'),
            binModalSummary: document.getElementById('stats-bin-summary'),
            // Glossary
            glossaryBtn:   document.getElementById('stats-glossary-btn'),
            glossaryModal: document.getElementById('stats-glossary-modal'),
            glossaryClose: document.getElementById('close-stats-glossary')
        };
    }

    populateFieldSelector() {
        const list = this.el.modalList;
        if (!list) return;
        list.replaceChildren();

        // Group by `group` then fall back to type
        const grouped = new Map();
        for (const f of this.fields) {
            const g = f.group || (f.type === 'numeric' ? 'Numeric' : 'Categorical');
            if (!grouped.has(g)) grouped.set(g, []);
            grouped.get(g).push(f);
        }

        const term = (this.el.modalSearch?.value || '').toLowerCase().trim();

        let any = false;
        for (const [groupLabel, items] of grouped) {
            const filtered = term
                ? items.filter(f =>
                    f.label.toLowerCase().includes(term) ||
                    f.key.toLowerCase().includes(term) ||
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
                type.textContent = f.type;

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

        this.updateFieldButton();
    }

    updateFieldButton() {
        const f = this.fields.find(x => x.key === this.selectedKey) || this.fields[0];
        if (!f) return;
        if (this.el.fieldBtnValue) {
            this.el.fieldBtnValue.textContent = f.unit ? `${f.label} (${f.unit})` : f.label;
        }
        if (this.el.typeBadge) {
            this.el.typeBadge.textContent = f.type;
            this.el.typeBadge.classList.toggle('is-numeric', f.type === 'numeric');
            this.el.typeBadge.classList.toggle('is-categorical', f.type === 'categorical');
        }
    }

    selectField(key) {
        this.selectedKey = key;
        this.closeModal();
        this.updateFieldButton();
        this.render();
    }

    openModal() {
        if (!this.el.modal) return;
        if (this.el.modalSearch) this.el.modalSearch.value = '';
        this.populateFieldSelector();
        this.el.modal.classList.add('active');
        document.body.classList.add('modal-open');
        setTimeout(() => this.el.modalSearch?.focus(), 80);
    }

    closeModal() {
        if (!this.el.modal) return;
        this.el.modal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }

    bindEvents() {
        this.el.fieldBtn?.addEventListener('click', () => this.openModal());
        this.el.modalClose?.addEventListener('click', () => this.closeModal());
        this.el.modal?.addEventListener('click', e => {
            if (e.target === this.el.modal) this.closeModal();
        });

        // Bin drill-down modal
        this.el.binModalClose?.addEventListener('click', () => this.closeBinModal());
        this.el.binModal?.addEventListener('click', e => {
            if (e.target === this.el.binModal) this.closeBinModal();
        });

        // Glossary modal
        this.el.glossaryBtn?.addEventListener('click', () => this.openGlossary());
        this.el.glossaryClose?.addEventListener('click', () => this.closeGlossary());
        this.el.glossaryModal?.addEventListener('click', e => {
            if (e.target === this.el.glossaryModal) this.closeGlossary();
        });

        let searchFrame = null;
        this.el.modalSearch?.addEventListener('input', () => {
            if (searchFrame) cancelAnimationFrame(searchFrame);
            searchFrame = requestAnimationFrame(() => this.populateFieldSelector());
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                if (this.el.glossaryModal?.classList.contains('active')) this.closeGlossary();
                else if (this.el.binModal?.classList.contains('active')) this.closeBinModal();
                else if (this.el.modal?.classList.contains('active')) this.closeModal();
            }
        });

        this.eventBus.on('data:loaded', () => this.render());
        this.eventBus.on('ui:tabChanged', ({ tab }) => {
            if (tab === 'statistics') this.render();
        });

        let resizeFrame = null;
        window.addEventListener('resize', () => {
            if (resizeFrame) cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(() => this.render());
        });
    }

    getData() {
        return this.stateManager?.get('currentData') || [];
    }

    render() {
        const records = this.getData();
        const field = this.fields.find(f => f.key === this.selectedKey) || this.fields[0];
        const raw = records.map(r => r ? r[field.key] : null);

        this.updateFieldButton();
        if (this.el.figTitle) {
            const unit = field.unit ? ` (${field.unit})` : '';
            this.el.figTitle.textContent = field.type === 'numeric'
                ? `Distribution of ${field.label.toLowerCase()}${unit}.`
                : `Frequency of ${field.label.toLowerCase()}.`;
        }

        if (records.length === 0) {
            this.renderEmpty('No records in current filter selection.');
            return;
        }

        if (field.type === 'numeric') {
            this.renderNumeric(field, raw);
        } else {
            this.renderCategorical(field, raw);
        }
    }

    renderEmpty(msg) {
        this.el.chartWrap.replaceChildren(textDiv('stats-empty', msg));
        this.el.axisLabel.textContent = '';
        this.el.summary.replaceChildren();
    }

    // ─── NUMERIC ─────────────────────────────────────────────────────────────
    renderNumeric(field, raw) {
        const { values } = toNumeric(raw);
        if (values.length === 0) {
            this.renderEmpty('No numeric data available for this variable.');
            this.renderSummary([['n', '0']]);
            return;
        }

        const summary = numericSummary(values);
        const useLog = Math.abs(summary.skew) > LOG_SKEW_THRESHOLD && summary.min > 0;
        const hist = histogram(values, summary, { logScale: useLog });
        const unitSuffix = field.unit ? ` ${field.unit}` : '';

        // Attach the actual records to each bin so the bar can drill down
        const records = this.getData();
        this.attachRecordsToBins(records, field, summary, hist, useLog);

        const axisBase = `${field.label}${field.unit ? ` (${field.unit})` : ''}`;
        this.el.axisLabel.replaceChildren(
            textSpan('stats-axis-label-main', axisBase),
            ...(useLog ? [textSpan('stats-axis-scale-tag', 'log scale')] : [])
        );
        this.el.chartWrap.replaceChildren(this.buildHistogramSVG(hist, summary, field, useLog));

        this.renderSummary([
            ['n',          fmtInt(summary.n)],
            ['Mean',       fmtNum(summary.mean) + unitSuffix],
            ['Median',     fmtNum(summary.median) + unitSuffix],
            ['Std. dev.',  fmtNum(summary.std) + unitSuffix],
            ['Min',        fmtNum(summary.min) + unitSuffix],
            ['Max',        fmtNum(summary.max) + unitSuffix],
            ['Range',      fmtNum(summary.range) + unitSuffix],
            ['Q1 (25%)',   fmtNum(summary.q1) + unitSuffix],
            ['Q3 (75%)',   fmtNum(summary.q3) + unitSuffix],
            ['IQR',        fmtNum(summary.iqr) + unitSuffix],
            ['Skewness',   fmtNum(summary.skew, { digits: 2 })]
        ]);
    }

    buildHistogramSVG(hist, summary, field, useLog = false) {
        const W = 320, H = 190;
        const M = { top: 14, right: 12, bottom: 30, left: 38 };
        const innerW = W - M.left - M.right;
        const innerH = H - M.top - M.bottom;

        const svg = el('svg', {
            viewBox: `0 0 ${W} ${H}`,
            preserveAspectRatio: 'xMidYMid meet',
            class: `stats-svg stats-histogram${useLog ? ' is-log' : ''}`,
            role: 'img',
            'aria-label': `Histogram of ${field.label}${useLog ? ' (log scale)' : ''}`
        });

        const g = el('g', { transform: `translate(${M.left},${M.top})` });
        svg.appendChild(g);

        const yMax = hist.max || 1;
        const project = useLog ? Math.log10 : (v => v);
        const xMinP = project(summary.min);
        const xMaxP = project(summary.max);
        const xRangeP = (xMaxP - xMinP) || 1;
        const xScale = v => ((project(v) - xMinP) / xRangeP) * innerW;
        const yScale = v => innerH - (v / yMax) * innerH;

        const gridG = el('g', { class: 'stats-gridlines' });
        const yTicks = niceTicks(0, yMax, 4);
        for (const t of yTicks) {
            gridG.appendChild(el('line', {
                x1: 0, x2: innerW, y1: yScale(t), y2: yScale(t),
                class: 'stats-gridline'
            }));
            gridG.appendChild(el('text', {
                x: -6, y: yScale(t),
                class: 'stats-tick-label stats-tick-y',
                'text-anchor': 'end',
                'dominant-baseline': 'middle'
            }, String(Math.round(t))));
        }
        g.appendChild(gridG);

        const barsG = el('g', { class: 'stats-bars' });
        for (const b of hist.bins) {
            const x = xScale(b.x0);
            const w = Math.max(1, xScale(b.x1) - xScale(b.x0) - 1);
            const y = yScale(b.count);
            const h = innerH - y;
            const rect = el('rect', {
                x, y, width: w, height: Math.max(0, h),
                class: 'stats-bar stats-bar-numeric'
            });
            const range = `[${fmtNum(b.x0)}, ${fmtNum(b.x1)}]`;
            this.attachTooltip(rect, `${range} · n=${b.count} · click to list`);
            const records = b.records || [];
            if (records.length > 0) {
                rect.style.cursor = 'pointer';
                rect.addEventListener('click', () => {
                    this.openBinModal({
                        field,
                        records,
                        title: `${field.label}: ${range}${field.unit ? ` ${field.unit}` : ''}`,
                        valueFormat: r => {
                            const v = parseFloat(r[field.key]);
                            return Number.isFinite(v) ? `${fmtNum(v)}${field.unit ? ` ${field.unit}` : ''}` : '—';
                        },
                        sortBy: r => -parseFloat(r[field.key])
                    });
                });
            }
            barsG.appendChild(rect);
        }
        g.appendChild(barsG);

        // Mean / median reference lines
        const refG = el('g', { class: 'stats-ref-lines' });
        const drawRef = (val, cls, label) => {
            const x = xScale(val);
            refG.appendChild(el('line', {
                x1: x, x2: x, y1: 0, y2: innerH,
                class: `stats-refline ${cls}`
            }));
            refG.appendChild(el('text', {
                x: x + 3, y: 4,
                class: `stats-reflabel ${cls}`,
                'dominant-baseline': 'hanging'
            }, label));
        };
        drawRef(summary.median, 'is-median', 'med');
        drawRef(summary.mean, 'is-mean', 'μ');
        g.appendChild(refG);

        const axisG = el('g', { class: 'stats-axis', transform: `translate(0,${innerH})` });
        axisG.appendChild(el('line', { x1: 0, x2: innerW, y1: 0, y2: 0, class: 'stats-axis-line' }));

        const xTicks = useLog
            ? logTicks(summary.min, summary.max).filter(t => t >= summary.min * 0.95 && t <= summary.max * 1.05)
            : niceTicks(summary.min, summary.max, 4);
        for (const t of xTicks) {
            const x = xScale(t);
            if (x < -2 || x > innerW + 2) continue;
            axisG.appendChild(el('line', { x1: x, x2: x, y1: 0, y2: 4, class: 'stats-tick' }));
            axisG.appendChild(el('text', {
                x, y: 16,
                class: 'stats-tick-label stats-tick-x',
                'text-anchor': 'middle'
            }, formatTickLabel(t, useLog)));
        }
        g.appendChild(axisG);

        return svg;
    }

    // ─── CATEGORICAL ─────────────────────────────────────────────────────────
    renderCategorical(field, raw) {
        const table = frequencyTable(raw, { topN: 12 });
        if (table.total === 0) {
            this.renderEmpty('No categorical data available for this variable.');
            this.renderSummary([['n', '0']]);
            return;
        }

        // Attach actual records to each entry for drill-down
        const records = this.getData();
        this.attachRecordsToCategoricalEntries(records, field, table);

        this.el.axisLabel.textContent = 'Count';
        this.el.chartWrap.replaceChildren(this.buildBarChartSVG(table, field));

        const modeStr = table.mode
            ? `${table.mode.value} (${table.mode.count} · ${(table.mode.ratio * 100).toFixed(1)}%)`
            : '—';

        this.renderSummary([
            ['n',       fmtInt(table.total)],
            ['Unique',  fmtInt(table.unique)],
            ['Mode',    modeStr]
        ]);
    }

    buildBarChartSVG(table, field) {
        const entries = table.entries;
        const rowH = 22;
        const gap = 4;
        const W = 320;
        const M = { top: 8, right: 48, bottom: 8, left: 104 };
        const innerW = W - M.left - M.right;
        const innerH = entries.length * (rowH + gap) - gap;
        const H = innerH + M.top + M.bottom;

        const svg = el('svg', {
            viewBox: `0 0 ${W} ${H}`,
            preserveAspectRatio: 'xMidYMid meet',
            class: 'stats-svg stats-barchart',
            role: 'img',
            'aria-label': `Frequency of ${field.label}`
        });

        const g = el('g', { transform: `translate(${M.left},${M.top})` });
        svg.appendChild(g);

        // Scale by non-"Other" max so a dominant Other bar doesn't squish everything else.
        const nonOther = entries.filter(e => !e.isOther);
        const max = (nonOther[0]?.count) || entries[0].count || 1;

        entries.forEach((e, i) => {
            const y = i * (rowH + gap);
            const rawW = (e.count / max) * innerW;
            const overflowed = rawW > innerW + 0.5;
            const w = Math.max(1, Math.min(innerW, rawW));

            const labelText = e.value.length > 14 ? e.value.slice(0, 13) + '…' : e.value;
            const labelEl = el('text', {
                x: -8, y: y + rowH / 2,
                class: `stats-cat-label${e.isOther ? ' is-other' : ''}`,
                'text-anchor': 'end',
                'dominant-baseline': 'middle'
            }, labelText);
            const titleEl = document.createElementNS(SVG_NS, 'title');
            titleEl.textContent = e.value;
            labelEl.appendChild(titleEl);
            g.appendChild(labelEl);

            g.appendChild(el('line', {
                x1: 0, x2: innerW,
                y1: y + rowH / 2, y2: y + rowH / 2,
                class: 'stats-bar-track'
            }));

            const rect = el('rect', {
                x: 0, y, width: w, height: rowH,
                class: `stats-bar stats-bar-cat${e.isOther ? ' is-other' : ''}${overflowed ? ' is-overflow' : ''}`
            });
            this.attachTooltip(rect, `${e.value} · n=${e.count} (${(e.ratio * 100).toFixed(1)}%) · click to list`);

            if (overflowed) {
                // Diagonal-stripe end cap on the right edge to indicate truncation
                g.appendChild(el('rect', {
                    x: innerW - 6, y, width: 6, height: rowH,
                    class: 'stats-bar-overflow-cap'
                }));
            }
            const recs = e.records || [];
            if (recs.length > 0) {
                rect.style.cursor = 'pointer';
                rect.addEventListener('click', () => {
                    this.openBinModal({
                        field,
                        records: recs,
                        title: `${field.label}: ${e.value}`,
                        valueFormat: r => String(r[field.key] ?? '—'),
                        sortBy: r => String(r.name_en || '')
                    });
                });
            }
            g.appendChild(rect);

            g.appendChild(el('text', {
                x: w + 6, y: y + rowH / 2,
                class: 'stats-bar-value',
                'dominant-baseline': 'middle'
            }, String(e.count)));
        });

        return svg;
    }

    // ─── helpers ─────────────────────────────────────────────────────────────
    renderSummary(rows) {
        const frag = document.createDocumentFragment();
        for (const [label, value] of rows) {
            const row = document.createElement('div');
            row.className = 'stats-row';

            const lbl = document.createElement('span');
            lbl.className = 'stats-row-label';
            lbl.textContent = label;

            const lead = document.createElement('span');
            lead.className = 'stats-row-leader';
            lead.setAttribute('aria-hidden', 'true');

            const val = document.createElement('span');
            val.className = 'stats-row-value';
            val.textContent = value;

            row.append(lbl, lead, val);
            frag.appendChild(row);
        }
        this.el.summary.replaceChildren(frag);
    }

    attachTooltip(target, text) {
        target.addEventListener('mouseenter', e => this.showTooltip(e, text));
        target.addEventListener('mousemove',  e => this.moveTooltip(e));
        target.addEventListener('mouseleave', () => this.hideTooltip());
    }

    showTooltip(e, text) {
        this.hideTooltip();
        const tip = document.createElement('div');
        tip.className = 'stats-tooltip';
        tip.textContent = text;
        document.body.appendChild(tip);
        this.activeTooltip = tip;
        this.moveTooltip(e);
    }

    moveTooltip(e) {
        if (!this.activeTooltip) return;
        const pad = 12;
        this.activeTooltip.style.left = `${e.clientX + pad}px`;
        this.activeTooltip.style.top  = `${e.clientY + pad}px`;
    }

    hideTooltip() {
        if (this.activeTooltip) {
            this.activeTooltip.remove();
            this.activeTooltip = null;
        }
    }

    // ─── bin → records attachment ────────────────────────────────────────────
    attachRecordsToBins(records, field, summary, hist, useLog) {
        const k = hist.bins.length;
        if (k === 0) return;
        for (const b of hist.bins) b.records = [];

        const project = useLog ? Math.log10 : v => v;
        const minP = project(summary.min);
        const maxP = project(summary.max);
        const range = maxP - minP;

        for (const r of records) {
            const v = parseFloat(r?.[field.key]);
            if (!Number.isFinite(v)) continue;
            if (useLog && v <= 0) continue;
            let idx;
            if (range === 0) {
                idx = 0;
            } else {
                idx = Math.floor((project(v) - minP) / (range / k));
                if (idx >= k) idx = k - 1;
                if (idx < 0) idx = 0;
            }
            hist.bins[idx].records.push(r);
        }
    }

    attachRecordsToCategoricalEntries(records, field, table) {
        const lookup = new Map();
        for (const e of table.entries) {
            e.records = [];
            if (!e.isOther) lookup.set(String(e.value), e.records);
        }
        const otherEntry = table.entries.find(e => e.isOther);

        for (const r of records) {
            const v = r?.[field.key];
            if (v == null) continue;
            const k = String(v).trim();
            if (k === '') continue;
            if (lookup.has(k)) lookup.get(k).push(r);
            else if (otherEntry) otherEntry.records.push(r);
        }
    }

    // ─── bin drill-down modal ────────────────────────────────────────────────
    openBinModal({ field, records, title, valueFormat, sortBy }) {
        if (!this.el.binModal || !records?.length) return;

        const sorted = [...records].sort((a, b) => {
            const av = sortBy(a), bv = sortBy(b);
            if (typeof av === 'number' && typeof bv === 'number') return av - bv;
            return String(av).localeCompare(String(bv));
        });

        if (this.el.binModalTitle) this.el.binModalTitle.textContent = title;
        if (this.el.binModalSummary) {
            this.el.binModalSummary.replaceChildren();
            const eyebrow = document.createElement('span');
            eyebrow.className = 'stats-bin-summary-count';
            eyebrow.textContent = `${sorted.length} lagoon${sorted.length === 1 ? '' : 's'}`;
            this.el.binModalSummary.appendChild(eyebrow);
        }

        const list = this.el.binModalList;
        list.replaceChildren();

        for (const r of sorted) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'filter-modal-option stats-bin-option';
            row.dataset.lagoonId = r.id;

            const main = document.createElement('span');
            main.className = 'stats-bin-main';
            const name = document.createElement('span');
            name.className = 'stats-bin-name';
            name.textContent = r.name_en || `#${r.id}`;
            main.appendChild(name);

            if (r.location_en || r.island_en) {
                const sub = document.createElement('span');
                sub.className = 'stats-bin-sub';
                sub.textContent = [r.location_en, r.island_en].filter(Boolean).join(' · ');
                main.appendChild(sub);
            }

            const val = document.createElement('span');
            val.className = 'stats-bin-value';
            val.textContent = valueFormat(r);

            row.append(main, val);
            row.addEventListener('click', () => this.handleBinRowClick(r));
            list.appendChild(row);
        }

        this.el.binModal.classList.add('active');
        document.body.classList.add('modal-open');
    }

    closeBinModal() {
        if (!this.el.binModal) return;
        this.el.binModal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }

    openGlossary() {
        if (!this.el.glossaryModal) return;
        this.el.glossaryModal.classList.add('active');
        document.body.classList.add('modal-open');
    }

    closeGlossary() {
        if (!this.el.glossaryModal) return;
        this.el.glossaryModal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }

    handleBinRowClick(record) {
        if (!record) return;
        this.closeBinModal();

        const lat = parseFloat(record.centroid_lat);
        const lng = parseFloat(record.centroid_lng);
        const map = this.mapManager?.getMap?.();
        const targetZoom = 12;

        const openDetail = () => {
            this.eventBus.emit('marker:clicked', {
                lagoonId: record.id,
                previewGeojson: null,
                centroidLat: Number.isFinite(lat) ? lat : null,
                centroidLng: Number.isFinite(lng) ? lng : null
            });
        };

        if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) {
            openDetail();
            return;
        }

        try { map.invalidateSize(false); } catch (_) {}

        // Open the detail modal only after the camera arrives.
        let done = false;
        let safety = null;
        const fire = () => {
            if (done) return;
            done = true;
            clearTimeout(safety);
            map.off('moveend', fire);
            openDetail();
        };
        map.on('moveend', fire);
        safety = setTimeout(fire, 1100);

        map.flyTo([lat, lng], targetZoom, { duration: 0.7 });
    }
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function el(name, attrs = {}, text) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        node.setAttribute(k, String(v));
    }
    if (text != null) node.textContent = text;
    return node;
}

function textDiv(className, text) {
    const d = document.createElement('div');
    d.className = className;
    d.textContent = text;
    return d;
}

function textSpan(className, text) {
    const s = document.createElement('span');
    s.className = className;
    s.textContent = text;
    return s;
}

function formatTickLabel(v, useLog) {
    if (!useLog) return fmtNum(v, { digits: 2 });
    // Log ticks are powers of 10 — render as 10^k or compact decimal
    if (v === 0) return '0';
    if (v >= 1 && v < 1000)  return String(v);
    if (v >= 0.001 && v < 1) return v.toString();
    const exp = Math.round(Math.log10(v));
    return `10${supExp(exp)}`;
}

function supExp(n) {
    const map = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³',
                  '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
    return String(n).split('').map(c => map[c] || c).join('');
}

function niceTicks(lo, hi, count = 5) {
    if (lo === hi) return [lo];
    const step = niceStep((hi - lo) / count);
    const start = Math.ceil(lo / step) * step;
    const out = [];
    for (let v = start; v <= hi + step * 1e-9; v += step) {
        out.push(+v.toFixed(12));
    }
    return out;
}

function niceStep(span) {
    if (span <= 0) return 1;
    const exp = Math.floor(Math.log10(span));
    const base = Math.pow(10, exp);
    const norm = span / base;
    let mult;
    if (norm < 1.5) mult = 1;
    else if (norm < 3) mult = 2;
    else if (norm < 7) mult = 5;
    else mult = 10;
    return mult * base;
}
