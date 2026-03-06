/**
 * GlobalSearch - Name / Location / Island search for Greek Lagoons
 */

import { escapeHtml, debounce } from '../utils/helpers.js';

class GlobalSearch {
    constructor(eventBus, stateManager, filterManager) {
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.filterManager = filterManager;

        this.elements = {
            input:     null,
            container: null,
            results:   null,
            clearBtn:  null
        };

        this._onInputDebounced = debounce(this.onInput.bind(this), 250);
    }

    init() {
        this.cacheElements();
        this.bindEvents();
        if (window.DEBUG_MODE) console.log('✅ GlobalSearch: Initialized');
    }

    cacheElements() {
        this.elements = {
            input:     document.getElementById('global-search'),
            container: document.getElementById('search-container'),
            results:   document.getElementById('search-results'),
            clearBtn:  document.getElementById('search-clear')
        };
    }

    bindEvents() {
        const { input, clearBtn } = this.elements;
        if (!input) return;

        input.addEventListener('input', this._onInputDebounced);
        input.addEventListener('keydown', e => {
            if (e.key === 'Escape') this.clearSearch();
        });

        input.addEventListener('focus', () => {
            if (input.value.trim()) this.showResults();
        });

        clearBtn?.addEventListener('click', () => this.clearSearch());

        // Hide on outside click
        document.addEventListener('click', e => {
            if (!e.target.closest('#search-container')) this.hideResults();
        });
    }

    onInput() {
        const query = this.elements.input?.value?.trim();

        if (!query || query.length < 1) {
            this.hideResults();
            this.elements.clearBtn && (this.elements.clearBtn.style.display = 'none');
            return;
        }

        this.elements.clearBtn && (this.elements.clearBtn.style.display = 'block');
        this.search(query);
    }

    search(query) {
        const lower = query.toLowerCase();
        const options = this.stateManager.get('filterOptions') || {};

        const locationMatches = (options.locations || [])
            .filter(v => v && v.toLowerCase().includes(lower))
            .slice(0, 8)
            .map(v => ({ type: 'location', label: 'Location', value: v, filterKey: 'location' }));

        const islandMatches = (options.islands || [])
            .filter(v => v && v.toLowerCase().includes(lower))
            .slice(0, 8)
            .map(v => ({ type: 'island', label: 'Island', value: v, filterKey: 'island' }));

        // Also search current marker data by lagoon name
        const currentData = this.stateManager.get('currentData') || [];
        const nameMatches = currentData
            .filter(r => r.name_en?.toLowerCase().includes(lower))
            .slice(0, 6)
            .map(r => ({ type: 'lagoon', label: 'Lagoon', value: r.name_en, id: r.id, filterKey: null }));

        const results = [...nameMatches, ...locationMatches, ...islandMatches];
        this.renderResults(results, query);
    }

    renderResults(results, query) {
        const { results: container } = this.elements;
        if (!container) return;

        if (results.length === 0) {
            container.innerHTML = '<div class="search-no-results">No results found</div>';
            this.showResults();
            return;
        }

        const typeOrder  = ['lagoon', 'location', 'island'];
        const typeLabel  = { lagoon: 'Lagoons', location: 'Locations', island: 'Islands' };
        const grouped    = {};

        results.forEach(r => {
            if (!grouped[r.type]) grouped[r.type] = [];
            grouped[r.type].push(r);
        });

        container.innerHTML = '';

        typeOrder.forEach(type => {
            if (!grouped[type]?.length) return;

            const section = document.createElement('div');
            section.className = 'search-results-section';
            section.innerHTML = `<div class="search-results-header">${typeLabel[type]}</div>`;

            grouped[type].forEach(item => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.innerHTML = `
                    <span class="search-result-icon ${type}-icon"></span>
                    <span class="search-result-text">${this._highlight(item.value, query)}</span>
                `;

                div.addEventListener('click', () => this.selectResult(item));
                section.appendChild(div);
            });

            container.appendChild(section);
        });

        this.showResults();
    }

    selectResult(item) {
        if (item.type === 'lagoon' && item.id != null) {
            // Open the detail modal directly
            this.eventBus.emit('marker:clicked', { lagoonId: item.id });
        } else if (item.filterKey) {
            this.filterManager.applyFilterValue(item.filterKey, item.value);
        }

        this.clearSearch();
    }

    clearSearch() {
        const { input, clearBtn } = this.elements;
        if (input) input.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        this.hideResults();
    }

    showResults() {
        this.elements.results?.classList.remove('hidden');
    }

    hideResults() {
        this.elements.results?.classList.add('hidden');
    }

    _highlight(text, query) {
        const escaped = escapeHtml(text);
        if (!query) return escaped;
        const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return escaped.replace(re, '<mark>$1</mark>');
    }
}

export default GlobalSearch;
