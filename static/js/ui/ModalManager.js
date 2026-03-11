/**
 * ModalManager - Modal lifecycle for Greek Lagoons
 */

import LagoonPreviewMap from '../map/LagoonPreviewMap.js';
import { escapeHtml } from '../utils/helpers.js';

class ModalManager {
    constructor(eventBus, cacheManager) {
        this.eventBus    = eventBus;
        this.cacheManager = cacheManager;

        this.modals      = new Map();
        this.activeModal = null;
        this.lagoonPreviewMap = new LagoonPreviewMap();
        this.lagoonPreviewContainer = null;

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

        container.innerHTML = this.generateLagoonDetailsHTML(lagoon);
        this.openModal(this.MODAL_IDS.LAGOON_DETAILS);
        this.renderLagoonPreview(previewData || lagoon);
    }

    generateLagoonDetailsHTML(lagoon) {
        if (!lagoon) return '<p>No data available.</p>';

        const fields = [
            { label: 'Name (EN)',          value: lagoon.name_en,          highlight: true },
            { label: 'Name (GR)',          value: lagoon.name_gr },
            { label: 'Location',           value: lagoon.location_en },
            { label: 'Island',             value: lagoon.island_en },
            { label: 'Area',               value: lagoon.area_km2 != null ? `${parseFloat(lagoon.area_km2).toFixed(3)} km²` : null },
            { label: 'Perimeter',          value: lagoon.perimeter_km2 != null ? `${parseFloat(lagoon.perimeter_km2).toFixed(3)} km` : null },
            { label: 'Length',             value: lagoon.length_m  != null ? `${parseFloat(lagoon.length_m).toFixed(1)} m` : null },
            { label: 'Width',              value: lagoon.width_m   != null ? `${parseFloat(lagoon.width_m).toFixed(1)} m` : null },
            { label: 'Sandspit Max Height', value: lagoon.height_m  != null ? `${parseFloat(lagoon.height_m).toFixed(1)} m` : null },
            { label: 'SSP1-2.6 SLR',       value: lagoon.rcp2_6_slr != null ? `${lagoon.rcp2_6_slr} m` : null },
            { label: 'SSP5-8.5 SLR',       value: lagoon.rcp8_5_slr != null ? `${lagoon.rcp8_5_slr} m` : null },
            { label: 'SSP1-2.6 Inundated', value: lagoon.rcp2_6_inundated, badge: true },
            { label: 'SSP5-8.5 Inundated', value: lagoon.rcp8_5_inundated, badge: true },
            { label: 'SSP1-2.6 SLR (VLM)',       value: lagoon.rcp2_6_vec_slr != null ? `${lagoon.rcp2_6_vec_slr} m` : null },
            { label: 'SSP5-8.5 SLR (VLM)',       value: lagoon.rcp8_5_vec_slr != null ? `${lagoon.rcp8_5_vec_slr} m` : null },
            { label: 'SSP1-2.6 Inundated (VLM)', value: lagoon.rcp2_6_vec_inundated, badge: true },
            { label: 'SSP5-8.5 Inundated (VLM)', value: lagoon.rcp8_5_vec_inundated, badge: true },
            { label: 'Data Quality',       value: lagoon.data_quality }
        ];

        let html = '';
        fields.forEach(f => {
            const raw   = f.value;
            const empty = raw == null || raw.toString().trim() === '';
            const val   = empty ? '-' : raw;

            let valHtml;
            if (f.badge && !empty) {
                const yes = String(val).toLowerCase() === 'yes';
                valHtml = `<span class="inundation-badge ${yes ? 'badge-yes' : 'badge-no'}">${escapeHtml(String(val))}</span>`;
            } else {
                valHtml = escapeHtml(String(val));
            }

            html += `
                <div class="detail-item ${f.highlight ? 'detail-item-highlighted' : ''}">
                    <div class="detail-label">${f.label}</div>
                    <div class="detail-value">${valHtml}</div>
                </div>`;
        });

        return `
            <section class="lagoon-modal-preview-panel">
                <div id="lagoon-modal-preview-map" class="lagoon-preview-map lagoon-modal-preview-map"></div>
            </section>
            <section class="lagoon-modal-details-grid">
                ${html}
            </section>
        `;
    }

    renderLagoonPreview(lagoon) {
        this.destroyLagoonPreview();

        requestAnimationFrame(() => {
            const previewContainer = document.getElementById('lagoon-modal-preview-map');
            if (!previewContainer) return;
            this.lagoonPreviewContainer = previewContainer;
            this.lagoonPreviewMap.render(previewContainer, lagoon || {});
        });
    }

    destroyLagoonPreview() {
        if (!this.lagoonPreviewContainer) return;
        this.lagoonPreviewMap.destroy(this.lagoonPreviewContainer);
        this.lagoonPreviewContainer = null;
    }

    isModalOpen(id = null) {
        return id ? this.activeModal === id : this.activeModal !== null;
    }

    getModalElement(id) {
        return this.modals.get(id)?.element ?? null;
    }
}

export default ModalManager;
