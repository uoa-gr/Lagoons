/**
 * stats.js — pure descriptive-statistics utilities.
 * Zero deps. Numerically straightforward; sample sizes are tiny (~10²).
 */

const isNum = v => typeof v === 'number' && Number.isFinite(v);

export function toNumeric(values) {
    const out = [];
    let missing = 0;
    for (const v of values) {
        if (v === null || v === undefined || v === '') { missing++; continue; }
        const n = typeof v === 'number' ? v : parseFloat(v);
        if (isNum(n)) out.push(n); else missing++;
    }
    return { values: out, missing };
}

export function quantile(sorted, p) {
    if (sorted.length === 0) return NaN;
    if (sorted.length === 1) return sorted[0];
    const h = (sorted.length - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function numericSummary(values) {
    const n = values.length;
    if (n === 0) return { n: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    const mean = sum / n;
    const variance = n > 1 ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
    const std = Math.sqrt(variance);
    const min = sorted[0];
    const max = sorted[n - 1];
    const q1 = quantile(sorted, 0.25);
    const median = quantile(sorted, 0.5);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;

    let skew = 0;
    if (n > 2 && std > 0) {
        const m3 = sorted.reduce((s, v) => s + (v - mean) ** 3, 0) / n;
        skew = m3 / std ** 3;
    }

    return { n, sum, mean, median, std, variance, min, max, q1, q3, iqr, range: max - min, skew, sorted };
}

/**
 * Histogram bins via Freedman–Diaconis with Sturges fallback.
 * Pass { logScale: true } to bin in log10 space (requires all values > 0).
 * Bin edges (x0, x1) are returned in original units regardless of scale.
 * Returns { bins: [{x0, x1, count}], binWidth, count, max, logScale }.
 */
export function histogram(values, summary, opts = {}) {
    const n = values.length;
    if (n === 0) return { bins: [], binWidth: 0, count: 0, max: 0, logScale: false };

    const useLog = !!opts.logScale && summary.min > 0;
    const project = useLog ? Math.log10 : (v => v);
    const unproject = useLog ? (x => Math.pow(10, x)) : (x => x);

    const { iqr } = summary;
    const minP = project(summary.min);
    const maxP = project(summary.max);

    if (minP === maxP) {
        return {
            bins: [{ x0: summary.min, x1: summary.max, count: n }],
            binWidth: 0, count: n, max: n, logScale: useLog
        };
    }

    let binWidth;
    if (!useLog && iqr > 0) {
        binWidth = 2 * iqr * Math.cbrt(1 / n);
    } else {
        // Sturges in projected space
        const k0 = Math.ceil(Math.log2(n) + 1);
        binWidth = (maxP - minP) / k0;
    }

    // For log: re-derive bin width directly from projected range (FD-on-log is fine too)
    let k = Math.ceil((maxP - minP) / (useLog ? binWidth : binWidth));
    if (!Number.isFinite(k) || k < 5) k = Math.max(5, Math.ceil(Math.sqrt(n)));
    if (k > 30) k = 30;
    binWidth = (maxP - minP) / k;

    const bins = Array.from({ length: k }, (_, i) => {
        const lo = minP + i * binWidth;
        const hi = minP + (i + 1) * binWidth;
        return { x0: unproject(lo), x1: unproject(hi), count: 0 };
    });

    for (const v of values) {
        let idx = Math.floor((project(v) - minP) / binWidth);
        if (idx >= k) idx = k - 1;
        if (idx < 0) idx = 0;
        bins[idx].count++;
    }

    const peak = bins.reduce((m, b) => Math.max(m, b.count), 0);
    return { bins, binWidth, count: n, max: peak, logScale: useLog };
}

/**
 * "Nice" tick positions for a log-scale axis (powers of 10 within the domain).
 */
export function logTicks(loVal, hiVal) {
    if (loVal <= 0 || hiVal <= 0 || loVal === hiVal) return [];
    const loExp = Math.floor(Math.log10(loVal));
    const hiExp = Math.ceil(Math.log10(hiVal));
    const out = [];
    for (let e = loExp; e <= hiExp; e++) {
        out.push(Math.pow(10, e));
    }
    return out;
}

/**
 * Frequency table for categorical values.
 * Returns { entries: [{value, count, ratio}], total, missing, unique, mode }.
 */
export function frequencyTable(values, { topN = 12 } = {}) {
    const counts = new Map();
    let total = 0;
    let missing = 0;
    for (const v of values) {
        if (v === null || v === undefined || v === '') { missing++; continue; }
        const k = String(v).trim();
        if (k === '') { missing++; continue; }
        counts.set(k, (counts.get(k) || 0) + 1);
        total++;
    }

    const all = [...counts.entries()]
        .map(([value, count]) => ({ value, count, ratio: total ? count / total : 0 }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

    let entries = all;
    let truncated = 0;
    if (all.length > topN) {
        const head = all.slice(0, topN - 1);
        const tail = all.slice(topN - 1);
        const otherCount = tail.reduce((s, e) => s + e.count, 0);
        truncated = tail.length;
        entries = [...head, {
            value: `Other (${tail.length})`,
            count: otherCount,
            ratio: total ? otherCount / total : 0,
            isOther: true
        }];
    }

    return {
        entries,
        total,
        missing,
        unique: counts.size,
        mode: all[0] || null,
        truncated
    };
}

/* Number formatting helpers */
export function fmtNum(v, { digits = 3 } = {}) {
    if (!isNum(v)) return '—';
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e6 || (a > 0 && a < 1e-3)) return v.toExponential(2);
    if (a >= 100) return v.toFixed(1);
    if (a >= 10)  return v.toFixed(2);
    return v.toFixed(digits);
}

export function fmtInt(v) {
    if (!isNum(v)) return '—';
    return Math.round(v).toLocaleString();
}
