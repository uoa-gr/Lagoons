/**
 * ModalManager - Modal lifecycle for Greek Lagoons
 */

import LagoonPreviewMap from '../map/LagoonPreviewMap.js';
import { escapeHtml } from '../utils/helpers.js';
import { resolveScenario } from '../utils/lagoon.js';

class ModalManager {
    constructor(eventBus, cacheManager) {
        this.eventBus    = eventBus;
        this.cacheManager = cacheManager;

        this.modals      = new Map();
        this.activeModal = null;
        this.lagoonPreviewMap = new LagoonPreviewMap();
        this.lagoonGreeceMap  = new LagoonPreviewMap();
        this.lagoonWorldMap   = new LagoonPreviewMap();
        this.lagoonPreviewContainer = null;
        this.lagoonGreeceContainer  = null;
        this.lagoonWorldContainer   = null;

        this.MODAL_IDS = {
            LAGOON_DETAILS:     'lagoon-modal',
            WELCOME:            'welcome-modal',
            REFERENCES:         'references-modal',
            SUBMIT_DATA:        'submit-data-modal',
            REPORT_BUG:         'report-bug-modal',
            SUBMIT_SUGGESTION:  'submit-suggestion-modal',
            SQL_FILTER:         'sql-filter-modal'
        };
    }

    init() {
        document.addEventListener('keydown', e => this.handleEscapeKey(e));
        this.cacheModalElements();
        this.setupModalCloseHandlers();
        this.setupWelcomeModal();

        if (window.DEBUG_MODE) console.log('✅ ModalManager: Initialized');
    }

    cacheModalElements() {
        Object.values(this.MODAL_IDS).forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                this.modals.set(id, {
                    element:  el,
                    closeBtn: el.querySelector('[id^="close-"]'),
                    content:  el.querySelector('.modal-content') || el
                });
            }
        });
    }

    setupModalCloseHandlers() {
        this.modals.forEach((data, id) => {
            data.closeBtn?.addEventListener('click', () => this.closeModal(id));
            data.element.addEventListener('click', e => {
                if (e.target === data.element) this.closeModal(id);
            });
        });
    }

    setupWelcomeModal() {
        const welcome = this.modals.get(this.MODAL_IDS.WELCOME);
        if (!welcome) return;

        setTimeout(() => this.openModal(this.MODAL_IDS.WELCOME), 300);

        document.getElementById('enter-webgis')?.addEventListener('click', () => {
            this.closeModal(this.MODAL_IDS.WELCOME);
        });

        document.getElementById('welcome-submit-data-link')?.addEventListener('click', e => {
            e.preventDefault();
            this.closeModal(this.MODAL_IDS.WELCOME);
            this.openModal(this.MODAL_IDS.SUBMIT_DATA);
        });
    }

    handleEscapeKey(e) {
        if (e.key === 'Escape' && this.activeModal) this.closeModal(this.activeModal);
    }

    openModal(id, options = {}) {
        const data = this.modals.get(id);
        if (!data) { console.warn(`ModalManager: "${id}" not found`); return; }

        if (this.activeModal && this.activeModal !== id) {
            this.closeModal(this.activeModal, { silent: true });
        }

        data.element.classList.add('active');
        document.body.classList.add('modal-open');
        this.activeModal = id;
        this.eventBus.emit('modal:opened', { modalId: id });
    }

    closeModal(id, { silent = false } = {}) {
        const data = this.modals.get(id);
        if (!data) return;

        if (id === this.MODAL_IDS.LAGOON_DETAILS) {
            this.destroyLagoonPreview();
        }

        data.element.classList.remove('active');
        document.body.classList.remove('modal-open');
        if (this.activeModal === id) this.activeModal = null;
        if (!silent) this.eventBus.emit('modal:closed', { modalId: id });
    }

    closeAll() {
        this.modals.forEach((_, id) => this.closeModal(id, { silent: true }));
        this.activeModal = null;
    }

    showLagoonDetails(lagoon, previewData = null) {
        const container = document.getElementById('lagoon-details');
        if (!container) return;

        const titleblock = document.getElementById('lagoon-modal-titleblock');
        if (titleblock) this._populateLagoonTitleblock(titleblock, lagoon);

        container.innerHTML = this.generateLagoonDetailsHTML(lagoon);
        this.openModal(this.MODAL_IDS.LAGOON_DETAILS);
        this.renderLagoonPreview(previewData || lagoon);
    }

    _populateLagoonTitleblock(host, lagoon) {
        host.replaceChildren();
        if (!lagoon) {
            const h = document.createElement('h2');
            h.className = 'lagoon-name-en';
            h.textContent = 'Lagoon';
            host.appendChild(h);
            return;
        }

        // Eyebrow tag: small uppercase "COASTAL LAGOON" mark (editorial flourish)
        const eyebrow = document.createElement('span');
        eyebrow.className = 'lagoon-eyebrow';
        eyebrow.textContent = 'Coastal lagoon';
        host.appendChild(eyebrow);

        // Name line: EN bold serif + thin separator + GR italic
        const nameLine = document.createElement('h2');
        nameLine.className = 'lagoon-name';
        const en = document.createElement('span');
        en.className = 'lagoon-name-en';
        en.textContent = lagoon.name_en || '—';
        nameLine.appendChild(en);
        if (lagoon.name_gr) {
            const sep = document.createElement('span');
            sep.className = 'lagoon-name-sep';
            sep.setAttribute('aria-hidden', 'true');
            sep.textContent = '/';
            nameLine.appendChild(sep);

            const gr = document.createElement('span');
            gr.className = 'lagoon-name-gr';
            gr.textContent = lagoon.name_gr;
            nameLine.appendChild(gr);
        }
        host.appendChild(nameLine);

        // Locality: pin icon + prefecture · island
        const loc    = (lagoon.location_en || '').trim();
        const island = (lagoon.island_en   || '').trim();
        const sameWord = loc && island && loc.toLowerCase() === island.toLowerCase();

        if (loc || island) {
            const p = document.createElement('p');
            p.className = 'lagoon-locality';

            const pin = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            pin.setAttribute('class', 'lagoon-locality-pin');
            pin.setAttribute('viewBox', '0 0 24 24');
            pin.setAttribute('fill', 'none');
            pin.setAttribute('stroke', 'currentColor');
            pin.setAttribute('stroke-width', '2');
            pin.setAttribute('stroke-linecap', 'round');
            pin.setAttribute('stroke-linejoin', 'round');
            pin.setAttribute('aria-hidden', 'true');
            const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path1.setAttribute('d', 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z');
            const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circ.setAttribute('cx', '12'); circ.setAttribute('cy', '10'); circ.setAttribute('r', '3');
            pin.append(path1, circ);
            p.appendChild(pin);

            if (loc) {
                const main = document.createElement('span');
                main.className = 'lagoon-locality-main';
                main.textContent = loc;
                p.appendChild(main);
            }

            if (island && (!loc || !sameWord)) {
                if (loc) {
                    const dot = document.createElement('span');
                    dot.className = 'lagoon-locality-dot';
                    dot.setAttribute('aria-hidden', 'true');
                    dot.textContent = '·';
                    p.appendChild(dot);
                }
                const isl = document.createElement('span');
                isl.className = 'lagoon-locality-island';
                isl.textContent = island;
                p.appendChild(isl);
            }
            host.appendChild(p);
        }
    }

    generateLagoonDetailsHTML(lagoon) {
        if (!lagoon) return '<p>No data available.</p>';

        const fmtNum = (v, digits = 3, unit = '') => {
            if (v == null || v === '') return null;
            const n = parseFloat(v);
            if (!Number.isFinite(n)) return null;
            return `${n.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
        };

        const morphometry = [
            { label: 'Area',                value: fmtNum(lagoon.area_km2,      3, 'km²') },
            { label: 'Perimeter',           value: fmtNum(lagoon.perimeter_km2, 3, 'km')  },
            { label: 'Length',              value: fmtNum(lagoon.length_m,      1, 'm')   },
            { label: 'Width',               value: fmtNum(lagoon.width_m,       1, 'm')   },
            { label: 'Sandspit Max Height', value: fmtNum(lagoon.height_m,      1, 'm')   }
        ];

        const ssp26 = resolveScenario(lagoon, 'ssp26');
        const ssp85 = resolveScenario(lagoon, 'ssp85');

        return `
            <section class="lagoon-modal-locators">
                <figure class="locator locator-detail">
                    <div id="lagoon-modal-preview-map" class="lagoon-preview-map lagoon-modal-preview-map"></div>
                    <figcaption>Lagoon polygon</figcaption>
                </figure>
                <figure class="locator locator-greece">
                    <div id="lagoon-modal-greece-map" class="lagoon-preview-map lagoon-modal-locator-map"></div>
                    <figcaption>Greece</figcaption>
                </figure>
                <figure class="locator locator-world">
                    <div id="lagoon-modal-world-map" class="lagoon-preview-map lagoon-modal-locator-map"></div>
                    <figcaption>World</figcaption>
                </figure>
            </section>

            ${this._renderSection('Morphometry', morphometry)}

            <section class="lagoon-modal-section">
                <header class="lagoon-modal-section-head">
                    <h4 class="lagoon-modal-section-title">Sea-level rise projections</h4>
                </header>
                ${this._renderScenariosTable(ssp26, ssp85)}
            </section>
        `;
    }

    _renderScenariosTable(s26, s85) {
        const fmtSlr   = v => v == null ? '—' : `${parseFloat(v).toFixed(2)} m`;
        const inundCell = v => {
            if (!v) return '<span class="inundation-badge badge-empty">—</span>';
            const t = String(v).trim();
            const cls = t.toLowerCase().startsWith('yes') ? 'badge-yes' : 'badge-no';
            return `<span class="inundation-badge ${cls}">${escapeHtml(t)}</span>`;
        };

        const cell = (s, key, kind) => {
            if (kind === 'slr') return `<td class="scenario-num">${escapeHtml(fmtSlr(key === 'geo' ? s.slrGeocentric : s.slrVlm))}</td>`;
            return `<td class="scenario-cat">${inundCell(key === 'geo' ? s.inundatedGeocentric : s.inundatedVlm)}</td>`;
        };

        const noVlm = !s26.hasLocalVlm && !s85.hasLocalVlm;
        const noVlmAny = !s26.hasLocalVlm || !s85.hasLocalVlm;

        return `
            <table class="lagoon-scenarios-table">
                <colgroup>
                    <col class="col-rowlabel" />
                    <col class="col-geo col-ssp26" />
                    <col class="col-vlm col-ssp26" />
                    <col class="col-geo col-ssp85" />
                    <col class="col-vlm col-ssp85" />
                </colgroup>
                <thead>
                    <tr class="ssp-header-row">
                        <th class="row-label-head" rowspan="2"></th>
                        <th class="ssp-head" colspan="2">
                            <span class="ssp-name">SSP1-2.6</span>
                            <span class="ssp-sub">low emissions</span>
                        </th>
                        <th class="ssp-head" colspan="2">
                            <span class="ssp-name">SSP5-8.5</span>
                            <span class="ssp-sub">high emissions</span>
                        </th>
                    </tr>
                    <tr class="basis-header-row">
                        <th class="basis-head">geocentric</th>
                        <th class="basis-head">VLM-corrected</th>
                        <th class="basis-head">geocentric</th>
                        <th class="basis-head">VLM-corrected</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <th class="row-label">SLR</th>
                        ${cell(s26, 'geo', 'slr')}
                        ${cell(s26, 'vlm', 'slr')}
                        ${cell(s85, 'geo', 'slr')}
                        ${cell(s85, 'vlm', 'slr')}
                    </tr>
                    <tr>
                        <th class="row-label">Inundated</th>
                        ${cell(s26, 'geo', 'inund')}
                        ${cell(s26, 'vlm', 'inund')}
                        ${cell(s85, 'geo', 'inund')}
                        ${cell(s85, 'vlm', 'inund')}
                    </tr>
                </tbody>
            </table>
            ${noVlmAny ? `<p class="lagoon-scenarios-note">${noVlm
                ? 'No local VLM measurement available for this lagoon — VLM-corrected columns fall back to the geocentric SSP outcome.'
                : 'VLM-corrected columns fall back to the geocentric SSP outcome where local VLM data is missing.'}</p>` : ''}
        `;
    }

    _renderSection(title, items, { highlightFirst = false } = {}) {
        if (!items.length) return '';
        const rows = items.map((it, i) => {
            const empty = it.value == null || String(it.value).trim() === '';
            const valHtml = escapeHtml(empty ? '—' : String(it.value));
            const cls = highlightFirst && i === 0 ? 'detail-item-highlighted' : (it.highlight ? 'detail-item-highlighted' : '');
            return `
                <div class="detail-item ${cls}">
                    <div class="detail-label">${escapeHtml(it.label)}</div>
                    <div class="detail-value">${valHtml}</div>
                </div>`;
        }).join('');

        return `
            <section class="lagoon-modal-section">
                <header class="lagoon-modal-section-head">
                    <h4 class="lagoon-modal-section-title">${escapeHtml(title)}</h4>
                </header>
                <div class="lagoon-modal-details-grid">${rows}</div>
            </section>
        `;
    }

    renderLagoonPreview(lagoon) {
        this.destroyLagoonPreview();

        // Defer to next tick so the modal's reflow is complete; setTimeout(0) is more
        // reliable than requestAnimationFrame here because the lagoon-modal can be
        // hidden at the moment of opening (rAF is throttled in some Chromium states).
        setTimeout(() => {
            const previewContainer = document.getElementById('lagoon-modal-preview-map');
            if (previewContainer) {
                this.lagoonPreviewContainer = previewContainer;
                this.lagoonPreviewMap.render(previewContainer, lagoon || {});
            }

            const greeceContainer = document.getElementById('lagoon-modal-greece-map');
            if (greeceContainer) {
                this.lagoonGreeceContainer = greeceContainer;
                this.lagoonGreeceMap.render(greeceContainer, lagoon || {}, {
                    locator: true,
                    // Bounding box covering the whole of Greece (incl. Crete + eastern Aegean)
                    fitBounds: [[34.5, 19.0], [42.0, 29.7]],
                    fitPadding: [6, 6]
                });
            }

            const worldContainer = document.getElementById('lagoon-modal-world-map');
            if (worldContainer) {
                this.lagoonWorldContainer = worldContainer;
                this.lagoonWorldMap.render(worldContainer, lagoon || {}, {
                    locator: true,
                    // Europe + N. Africa + W. Asia framing — keeps Greece on screen at any size
                    fitBounds: [[-10, -25], [60, 60]],
                    fitPadding: [4, 4]
                });
            }
        }, 0);
    }

    destroyLagoonPreview() {
        if (this.lagoonPreviewContainer) {
            this.lagoonPreviewMap.destroy(this.lagoonPreviewContainer);
            this.lagoonPreviewContainer = null;
        }
        if (this.lagoonGreeceContainer) {
            this.lagoonGreeceMap.destroy(this.lagoonGreeceContainer);
            this.lagoonGreeceContainer = null;
        }
        if (this.lagoonWorldContainer) {
            this.lagoonWorldMap.destroy(this.lagoonWorldContainer);
            this.lagoonWorldContainer = null;
        }
    }

    isModalOpen(id = null) {
        return id ? this.activeModal === id : this.activeModal !== null;
    }

    getModalElement(id) {
        return this.modals.get(id)?.element ?? null;
    }
}

export default ModalManager;
