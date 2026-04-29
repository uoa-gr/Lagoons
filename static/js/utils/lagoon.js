/**
 * lagoon.js — domain helpers for Greek coastal lagoon records.
 *
 * Schema notes (live in DB, mirror SQL file):
 *   - rcp{2_6,8_5}_slr             : DOUBLE — geocentric SLR (m), always populated
 *   - rcp{2_6,8_5}_vec_slr         : DOUBLE — VLM-corrected SLR (m); 0 = no local VLM data
 *   - rcp{2_6,8_5}_inundated       : TEXT   — "yes" / "no", geocentric basis
 *   - rcp{2_6,8_5}_vec_inundated   : TEXT   — "yes" / "no" / "yes (SSP-based)" / "no (SSP-based)"
 *                                     "(SSP-based)" suffix marks the geocentric fallback when
 *                                     no local VLM was available for that lagoon.
 *
 * The "(SSP-based)" suffix in vec_inundated lines up exactly with vec_slr === 0
 * (45 % of records, 69 / 152 lagoons).
 *
 * resolveScenario picks the most-meaningful single value for a given scenario:
 *   primary        → VLM-corrected when available, else geocentric
 *   primaryBasis   → 'vlm'    | 'geocentric'
 *   geocentric     → always available
 *   vlm            → only when local VLM exists (else null)
 */

const SCENARIOS = [
    { key: 'ssp26', label: 'SSP1-2.6', sublabel: 'low emissions',  slr: 'rcp2_6_slr', vecSlr: 'rcp2_6_vec_slr', inund: 'rcp2_6_inundated', vecInund: 'rcp2_6_vec_inundated' },
    { key: 'ssp85', label: 'SSP5-8.5', sublabel: 'high emissions', slr: 'rcp8_5_slr', vecSlr: 'rcp8_5_vec_slr', inund: 'rcp8_5_inundated', vecInund: 'rcp8_5_vec_inundated' }
];

const VLM_ZERO_EPS = 1e-9; // treat values smaller than this as the "no VLM" sentinel

function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
}

function vecAvailable(vecSlr) {
    const n = num(vecSlr);
    return n !== null && Math.abs(n) > VLM_ZERO_EPS;
}

function stripSspBased(vecInund) {
    if (vecInund == null) return { value: null, fallback: false };
    const s = String(vecInund).trim();
    const fallback = /\(\s*SSP[\s-]based\s*\)/i.test(s);
    const cleaned = s.replace(/\s*\(\s*SSP[\s-]based\s*\)\s*/i, '').trim() || null;
    return { value: cleaned, fallback };
}

export function resolveScenario(record, scenarioKey) {
    const scn = SCENARIOS.find(s => s.key === scenarioKey);
    if (!scn || !record) return null;

    const slr     = num(record[scn.slr]);
    const vecRaw  = record[scn.vecSlr];
    const vlmHas  = vecAvailable(vecRaw);
    const vlmSlr  = vlmHas ? num(vecRaw) : null;

    const inundGeo = record[scn.inund] != null ? String(record[scn.inund]).trim() : null;
    const { value: inundVlmClean, fallback: inundFallback } = stripSspBased(record[scn.vecInund]);
    const inundVlmReal = inundFallback ? null : inundVlmClean;

    return {
        scenario: scn.label,
        scenarioKey: scn.key,
        sublabel: scn.sublabel,

        // Resolved primary (VLM if real, else geocentric)
        slr:           vlmHas ? vlmSlr   : slr,
        slrBasis:      vlmHas ? 'vlm'    : 'geocentric',

        inundated:     inundFallback || !inundVlmClean ? inundGeo : inundVlmClean,
        inundatedBasis: inundFallback || !inundVlmClean ? 'geocentric' : 'vlm',

        // Always-available raw geocentric
        slrGeocentric:       slr,
        inundatedGeocentric: inundGeo,

        // VLM-only values (null when not measured)
        slrVlm:       vlmSlr,
        inundatedVlm: inundVlmReal,

        // Provenance flags
        hasLocalVlm:        vlmHas,
        inundatedHasVlm:    !inundFallback && inundVlmClean !== null
    };
}

export function resolveAllScenarios(record) {
    return SCENARIOS.map(s => resolveScenario(record, s.key));
}

export const LAGOON_SCENARIOS = SCENARIOS;
