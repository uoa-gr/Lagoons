/**
 * LagoonHoverCard — shared rich tooltip used by both centroid markers
 * and polygon outlines, plus a helper that keeps the tooltip clamped
 * inside the map container (and flips top↔bottom when a target is too
 * close to the viewport edge).
 */

import { escapeHtml } from '../utils/helpers.js';

export function buildLagoonHoverHTML(lagoon) {
    const fmtNum = (v, digits, unit) => {
        if (v == null || v === '') return '—';
        const n = parseFloat(v);
        return Number.isFinite(n) ? `${n.toFixed(digits)} ${unit}` : '—';
    };

    const area = fmtNum(lagoon.area_km2, 2, 'km²');

    // Pick VLM-corrected when available, geocentric otherwise; tag which one is shown.
    // (vec_slr === 0 is a sentinel for "no local VLM" — already normalised to null upstream.)
    const slrParts = (vecVal, geoVal) => {
        const vec = parseFloat(vecVal);
        const geo = parseFloat(geoVal);
        const useVlm = Number.isFinite(vec) && Math.abs(vec) > 1e-9;
        const v = useVlm ? vec : geo;
        const tag = useVlm ? 'VLM' : 'geo';
        return Number.isFinite(v)
            ? { value: `${parseFloat(v).toFixed(2)} m`, tag }
            : { value: '—', tag: null };
    };
    const slr_26 = slrParts(lagoon.rcp2_6_vec_slr, lagoon.rcp2_6_slr);
    const slr_85 = slrParts(lagoon.rcp8_5_vec_slr, lagoon.rcp8_5_slr);
    const slrTagHtml = (t) => t.tag
        ? `<span class="lagoon-hover-basis-tag is-${t.tag}">${t.tag}</span>`
        : '<span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>';

    const loc      = (lagoon.location_en || '').trim();
    const island   = (lagoon.island_en   || '').trim();
    const sameWord = loc && island && loc.toLowerCase() === island.toLowerCase();
    const localityHtml = (loc || island)
        ? `<div class="lagoon-hover-locality">
             <svg class="lagoon-hover-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                 <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                 <circle cx="12" cy="10" r="3"/>
             </svg>
             ${loc ? `<span class="lagoon-hover-loc-main">${escapeHtml(loc)}</span>` : ''}
             ${island && (!loc || !sameWord) ? `${loc ? `<span class="lagoon-hover-loc-dot" aria-hidden="true">·</span>` : ''}<span class="lagoon-hover-loc-island">${escapeHtml(island)}</span>` : ''}
           </div>`
        : '';

    return `
        <div class="lagoon-hover-card">
            <div class="lagoon-hover-preview">
                <div class="lagoon-preview-map" data-tooltip-preview-map></div>
            </div>
            <div class="lagoon-hover-body">
                <span class="lagoon-hover-eyebrow">Coastal lagoon</span>
                <h3 class="lagoon-hover-name">
                    <span class="lagoon-hover-name-en">${escapeHtml(lagoon.name_en || 'Unnamed')}</span>
                    ${lagoon.name_gr ? `
                        <span class="lagoon-hover-name-sep" aria-hidden="true">/</span>
                        <span class="lagoon-hover-name-gr">${escapeHtml(lagoon.name_gr)}</span>
                    ` : ''}
                </h3>
                ${localityHtml}
                <div class="lagoon-hover-stats">
                    <div class="lagoon-hover-stat">
                        <span class="lagoon-hover-stat-label">Area</span>
                        <span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>
                        <span class="lagoon-hover-stat-value">${escapeHtml(area)}</span>
                    </div>
                    <div class="lagoon-hover-stat">
                        <span class="lagoon-hover-stat-label">SSP1-2.6 SLR</span>
                        ${slrTagHtml(slr_26)}
                        <span class="lagoon-hover-stat-value">${escapeHtml(slr_26.value)}</span>
                    </div>
                    <div class="lagoon-hover-stat">
                        <span class="lagoon-hover-stat-label">SSP5-8.5 SLR</span>
                        ${slrTagHtml(slr_85)}
                        <span class="lagoon-hover-stat-value">${escapeHtml(slr_85.value)}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Keep a Leaflet tooltip inside its map container's viewport.
 *
 *  - Flips direction top↔bottom (rebinding the inverse offset) if the
 *    rendered tooltip overflows that edge.
 *  - Applies a residual CSS `translate` nudge so any leftover horizontal
 *    or vertical overflow is clamped.
 *
 * Safe to call repeatedly (e.g. on every sticky-tooltip mousemove).
 */
export function pinTooltipInsideMap(tooltip, map, opts = {}) {
    const el = tooltip?.getElement?.();
    if (!el || !map) return;

    const margin    = opts.margin    ?? 8;
    const topOffset = opts.topOffset ?? [0, -14];
    const botOffset = opts.botOffset ?? [0,  14];

    const mapRect = map.getContainer().getBoundingClientRect();
    let elRect    = el.getBoundingClientRect();

    // Vertical overflow → flip direction & re-render position
    const overflowsTop    = elRect.top    < mapRect.top    + margin;
    const overflowsBottom = elRect.bottom > mapRect.bottom - margin;
    const dir = tooltip.options.direction;

    if (overflowsTop && dir !== 'bottom') {
        tooltip.options.direction = 'bottom';
        tooltip.options.offset    = botOffset;
        tooltip.update();
        elRect = el.getBoundingClientRect();
    } else if (overflowsBottom && dir !== 'top') {
        tooltip.options.direction = 'top';
        tooltip.options.offset    = topOffset;
        tooltip.update();
        elRect = el.getBoundingClientRect();
    }

    // Residual horizontal/vertical clamp via CSS `translate` (additive to
    // Leaflet's transform, so positioning math is left untouched).
    let dx = 0, dy = 0;
    if (elRect.left  < mapRect.left  + margin) dx = (mapRect.left  + margin) - elRect.left;
    if (elRect.right > mapRect.right - margin) dx = (mapRect.right - margin) - elRect.right;
    if (elRect.top   < mapRect.top   + margin) dy = (mapRect.top   + margin) - elRect.top;
    if (elRect.bottom > mapRect.bottom - margin) dy = (mapRect.bottom - margin) - elRect.bottom;

    el.style.translate = (dx || dy) ? `${dx}px ${dy}px` : '';
}
