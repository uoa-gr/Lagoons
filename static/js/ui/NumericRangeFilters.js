/**
 * NumericRangeFilters — dual-thumb sliders for numeric lagoon variables.
 *
 * Each slider exposes a min/max range over the full dataset. Skewed variables
 * (Area, Perimeter) use a log10 scale so the entire range is selectable; the
 * rest are linear. Values are filtered client-side; this module emits a
 * `numericRanges:changed` event whenever the user releases a thumb.
 *
 * The active range for a field is removed from the URL of `getActiveRanges()`
 * once it spans the full domain, so the filter "auto-clears" when the user
 * drags both thumbs to the extremes.
 */

const FIELDS = [
    // Morphometry
    { key: 'area_km2',      label: 'Area',                     unit: 'km²', scale: 'log',    digits: 3, group: 'Morphometry' },
    { key: 'perimeter_km2', label: 'Perimeter',                unit: 'km',  scale: 'log',    digits: 3, group: 'Morphometry' },
    { key: 'length_m',      label: 'Length',                   unit: 'm',   scale: 'linear', digits: 0, group: 'Morphometry' },
    { key: 'width_m',       label: 'Width',                    unit: 'm',   scale: 'linear', digits: 0, group: 'Morphometry' },
    { key: 'height_m',      label: 'Sandspit Max Height',      unit: 'm',   scale: 'linear', digits: 1, group: 'Morphometry' },

    // SLR projections
    { key: 'rcp2_6_slr',     label: 'SLR (geocentric)',     unit: 'm', scale: 'linear', digits: 2, group: 'SSP1-2.6 SLR' },
    { key: 'rcp2_6_vec_slr', label: 'SLR (VLM-corrected)',  unit: 'm', scale: 'linear', digits: 2, group: 'SSP1-2.6 SLR' },
    { key: 'rcp8_5_slr',     label: 'SLR (geocentric)',     unit: 'm', scale: 'linear', digits: 2, group: 'SSP5-8.5 SLR' },
    { key: 'rcp8_5_vec_slr', label: 'SLR (VLM-corrected)',  unit: 'm', scale: 'linear', digits: 2, group: 'SSP5-8.5 SLR' }
];

const STEPS = 200;     // 0..200 internal range
const EPS   = 1e-12;

export default class NumericRangeFilters {
    constructor(eventBus, stateManager) {
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.host = null;
        this.bounds = new Map();   // field -> { min, max }
        this.values = new Map();   // field -> { lo, hi }   (in user units)
        this.expanded = new Set(); // expanded group labels
    }

    init() {
        this.host = document.getElementById('numeric-range-filters');
        if (!this.host) return;

        this.eventBus.on('data:loaded', () => this.rebuild());
        // Initial build attempt (data may already be in stateManager)
        this.rebuild();
        if (window.DEBUG_MODE) console.log('✅ NumericRangeFilters: Initialized');
    }

    rebuild() {
        if (!this.host) return;
        const records = this.stateManager?.get('currentData') || [];
        if (!records.length) return;

        // Snapshot dataset bounds — but only do this ONCE so user-set ranges
        // survive across filter changes. Re-compute only if a field has no bounds yet.
        for (const f of FIELDS) {
            if (this.bounds.has(f.key)) continue;
            let min = Infinity, max = -Infinity;
            for (const r of records) {
                const v = parseFloat(r?.[f.key]);
                if (!Number.isFinite(v)) continue;
                if (f.scale === 'log' && v <= 0) continue;
                if (v < min) min = v;
                if (v > max) max = v;
            }
            if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) continue;
            this.bounds.set(f.key, { min, max });
            this.values.set(f.key, { lo: min, hi: max });
        }

        this.render();
    }

    /**
     * Returns active ranges (those narrowed from full domain).
     * Shape: { area_km2: { min, max }, ... }
     */
    getActiveRanges() {
        const out = {};
        for (const f of FIELDS) {
            const b = this.bounds.get(f.key);
            const v = this.values.get(f.key);
            if (!b || !v) continue;
            const narrowed = (v.lo > b.min + Math.abs(b.max - b.min) * EPS) ||
                             (v.hi < b.max - Math.abs(b.max - b.min) * EPS);
            if (narrowed) out[f.key] = { min: v.lo, max: v.hi };
        }
        return out;
    }

    clearAll() {
        for (const f of FIELDS) {
            const b = this.bounds.get(f.key);
            if (b) this.values.set(f.key, { lo: b.min, hi: b.max });
        }
        this.render();
        this.eventBus.emit('numericRanges:changed', { ranges: this.getActiveRanges() });
    }

    /**
     * Programmatically set a range and emit. Used by FilterByChart's brush.
     * Pass null/undefined for lo or hi to mean "extreme of the bound".
     */
    setRange(fieldKey, lo, hi) {
        const b = this.bounds.get(fieldKey);
        if (!b) return false;
        let loV = (lo == null || !Number.isFinite(lo)) ? b.min : lo;
        let hiV = (hi == null || !Number.isFinite(hi)) ? b.max : hi;
        if (loV > hiV) [loV, hiV] = [hiV, loV];
        loV = Math.max(b.min, Math.min(b.max, loV));
        hiV = Math.max(b.min, Math.min(b.max, hiV));
        this.values.set(fieldKey, { lo: loV, hi: hiV });
        this.render();
        this.eventBus.emit('numericRanges:changed', { ranges: this.getActiveRanges() });
        return true;
    }

    /** Public read of bounds + current values for a field (for FilterByChart). */
    getFieldState(fieldKey) {
        const b = this.bounds.get(fieldKey);
        const v = this.values.get(fieldKey);
        if (!b || !v) return null;
        return { min: b.min, max: b.max, lo: v.lo, hi: v.hi };
    }

    /** Reset a single field to its full bounds. */
    resetField(fieldKey) {
        return this.setRange(fieldKey, null, null);
    }

    render() {
        this.host.replaceChildren();

        const groups = new Map();
        for (const f of FIELDS) {
            if (!this.bounds.has(f.key)) continue;
            if (!groups.has(f.group)) groups.set(f.group, []);
            groups.get(f.group).push(f);
        }

        for (const [groupLabel, fields] of groups) {
            // Each group is its own minimal accordion — no outer box, just a soft heading
            const details = document.createElement('details');
            details.className = 'range-group';
            if (this.expanded.has(groupLabel)) details.open = true;

            const summary = document.createElement('summary');
            summary.className = 'range-group-summary';

            const heading = document.createElement('span');
            heading.className = 'range-group-heading';
            heading.textContent = groupLabel;
            summary.appendChild(heading);

            const count = this._activeCountForGroup(fields);
            if (count > 0) {
                const badge = document.createElement('span');
                badge.className = 'range-group-badge';
                badge.textContent = String(count);
                summary.appendChild(badge);
            }
            details.appendChild(summary);

            details.addEventListener('toggle', () => {
                if (details.open) this.expanded.add(groupLabel);
                else this.expanded.delete(groupLabel);
            });

            const rows = document.createElement('div');
            rows.className = 'range-group-rows';
            for (const f of fields) rows.appendChild(this._renderRow(f));
            details.appendChild(rows);

            this.host.appendChild(details);
        }
    }

    _activeCountForGroup(fields) {
        const eps = EPS;
        return fields.reduce((n, f) => {
            const b = this.bounds.get(f.key); const v = this.values.get(f.key);
            if (!b || !v) return n;
            const span = Math.abs(b.max - b.min);
            const narrowed = (v.lo > b.min + span * eps) || (v.hi < b.max - span * eps);
            return n + (narrowed ? 1 : 0);
        }, 0);
    }

    _renderRow(field) {
        const row = document.createElement('div');
        row.className = 'range-row';
        row.dataset.field = field.key;

        // Label
        const labelLine = document.createElement('div');
        labelLine.className = 'range-label-line';

        const labelText = document.createElement('span');
        labelText.className = 'range-label';
        labelText.textContent = `${field.label}${field.unit ? ` (${field.unit})` : ''}`;
        labelLine.appendChild(labelText);

        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'range-reset';
        reset.title = 'Reset to full range';
        reset.textContent = '↺';
        reset.addEventListener('click', () => this._reset(field.key));
        labelLine.appendChild(reset);

        row.appendChild(labelLine);

        // Slider widget
        const widget = document.createElement('div');
        widget.className = 'range-slider';
        widget.appendChild(this._sliderTrack(field));
        row.appendChild(widget);

        // Readout
        const readout = document.createElement('div');
        readout.className = 'range-readout';
        const lo = document.createElement('span'); lo.className = 'range-readout-lo';
        const sep = document.createElement('span'); sep.className = 'range-readout-sep'; sep.textContent = '–';
        const hi = document.createElement('span'); hi.className = 'range-readout-hi';
        readout.append(lo, sep, hi);
        row.appendChild(readout);

        this._refreshRow(field, row);
        return row;
    }

    _sliderTrack(field) {
        const wrap = document.createElement('div');
        wrap.className = 'range-track-wrap';

        const track = document.createElement('div');
        track.className = 'range-track';
        const fill = document.createElement('div');
        fill.className = 'range-fill';
        track.appendChild(fill);
        wrap.appendChild(track);

        const inputLo = document.createElement('input');
        inputLo.type = 'range'; inputLo.className = 'range-input range-input-lo';
        inputLo.min = '0'; inputLo.max = String(STEPS); inputLo.step = '1';

        const inputHi = document.createElement('input');
        inputHi.type = 'range'; inputHi.className = 'range-input range-input-hi';
        inputHi.min = '0'; inputHi.max = String(STEPS); inputHi.step = '1';

        const onInput = () => {
            let lo = parseInt(inputLo.value, 10);
            let hi = parseInt(inputHi.value, 10);
            if (lo > hi) { [lo, hi] = [hi, lo]; }
            const b = this.bounds.get(field.key);
            const loV = this._sliderToValue(field, lo, b);
            const hiV = this._sliderToValue(field, hi, b);
            this.values.set(field.key, { lo: loV, hi: hiV });
            this._refreshFillAndReadout(field, wrap.parentElement.parentElement);
        };

        const onCommit = () => {
            this.eventBus.emit('numericRanges:changed', { ranges: this.getActiveRanges() });
            // Update active count badge in summary
            this.render();
        };

        inputLo.addEventListener('input', onInput);
        inputHi.addEventListener('input', onInput);
        inputLo.addEventListener('change', onCommit);
        inputHi.addEventListener('change', onCommit);

        wrap.append(inputLo, inputHi);
        return wrap;
    }

    _refreshRow(field, row) {
        this._refreshFillAndReadout(field, row);
        const b = this.bounds.get(field.key);
        const v = this.values.get(field.key);
        if (!b || !v) return;
        const lo = this._valueToSlider(field, v.lo, b);
        const hi = this._valueToSlider(field, v.hi, b);
        const inputLo = row.querySelector('.range-input-lo');
        const inputHi = row.querySelector('.range-input-hi');
        if (inputLo) inputLo.value = String(lo);
        if (inputHi) inputHi.value = String(hi);
    }

    _refreshFillAndReadout(field, row) {
        const b = this.bounds.get(field.key);
        const v = this.values.get(field.key);
        if (!b || !v) return;
        const fill = row.querySelector('.range-fill');
        const lo = this._valueToSlider(field, v.lo, b);
        const hi = this._valueToSlider(field, v.hi, b);
        if (fill) {
            fill.style.left  = `${(lo / STEPS) * 100}%`;
            fill.style.right = `${(1 - hi / STEPS) * 100}%`;
        }

        const fmt = (x) => {
            if (!Number.isFinite(x)) return '—';
            if (field.digits === 0) return Math.round(x).toLocaleString();
            return x.toFixed(field.digits);
        };
        const loEl = row.querySelector('.range-readout-lo');
        const hiEl = row.querySelector('.range-readout-hi');
        if (loEl) loEl.textContent = `${fmt(v.lo)}${field.unit ? ` ${field.unit}` : ''}`;
        if (hiEl) hiEl.textContent = `${fmt(v.hi)}${field.unit ? ` ${field.unit}` : ''}`;
    }

    _valueToSlider(field, v, b) {
        if (field.scale === 'log') {
            const lmin = Math.log10(b.min); const lmax = Math.log10(b.max);
            const lv = Math.log10(Math.max(v, b.min));
            return Math.round(((lv - lmin) / (lmax - lmin)) * STEPS);
        }
        return Math.round(((v - b.min) / (b.max - b.min)) * STEPS);
    }

    _sliderToValue(field, slider, b) {
        const t = slider / STEPS;
        if (field.scale === 'log') {
            const lmin = Math.log10(b.min); const lmax = Math.log10(b.max);
            return Math.pow(10, lmin + t * (lmax - lmin));
        }
        return b.min + t * (b.max - b.min);
    }

    _reset(field) {
        const b = this.bounds.get(field);
        if (!b) return;
        this.values.set(field, { lo: b.min, hi: b.max });
        this.render();
        this.eventBus.emit('numericRanges:changed', { ranges: this.getActiveRanges() });
    }
}

export { FIELDS as NUMERIC_RANGE_FIELDS };
