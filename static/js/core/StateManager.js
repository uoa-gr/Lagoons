import EventBus from './EventBus.js';

class StateManager {
    constructor(eventBus) {
        this.eventBus = eventBus;

        this.state = {
            currentData: [],
            filterOptions: { locations: [], islands: [], rcp2_6_values: [], rcp8_5_values: [] },
            activeFilters: { location: null, island: null, rcp2_6_inundated: null, rcp8_5_inundated: null },
            activeSqlFilter: null,
            isLoading: false,
            visiblePoints: 0,
            isMobileSidebarOpen: false,
            activeTab: 'filters',
            activeModal: null,
            mapInstance: null,
            mapBounds: null,
            selectedLagoonId: null
        };

        this.subscribers = new Map();
    }

    get(key) {
        if (!key) return this.state;
        const keys = key.split('.');
        let value = this.state;
        for (const k of keys) {
            if (value === null || value === undefined) return undefined;
            value = value[k];
        }
        return value;
    }

    set(key, value, silent = false) {
        if (!key) { console.error('StateManager.set: Key is required'); return; }
        const oldValue = this.get(key);
        if (oldValue === value) return;

        const keys = key.split('.');
        const lastKey = keys.pop();
        let target = this.state;
        for (const k of keys) {
            if (!(k in target)) target[k] = {};
            target = target[k];
        }
        target[lastKey] = value;

        if (window.DEBUG_MODE) console.log(`🗃️ StateManager: Set "${key}"`, { oldValue, newValue: value });

        if (!silent) {
            this._notifySubscribers(key, value, oldValue);
            this.eventBus.emit('state:changed', { key, newValue: value, oldValue });
        }
    }

    subscribe(key, callback) {
        if (!key || typeof callback !== 'function') { console.error('StateManager.subscribe: Invalid arguments'); return () => {}; }
        if (!this.subscribers.has(key)) this.subscribers.set(key, []);
        this.subscribers.get(key).push(callback);
        return () => this.unsubscribe(key, callback);
    }

    unsubscribe(key, callback) {
        if (!this.subscribers.has(key)) return;
        const callbacks = this.subscribers.get(key);
        const index = callbacks.indexOf(callback);
        if (index !== -1) callbacks.splice(index, 1);
        if (callbacks.length === 0) this.subscribers.delete(key);
    }

    _notifySubscribers(key, newValue, oldValue) {
        if (!this.subscribers.has(key)) return;
        this.subscribers.get(key).slice().forEach(callback => {
            try { callback(newValue, oldValue); } catch (error) { console.error(`StateManager: Error in subscriber for "${key}"`, error); }
        });
    }

    reset(silent = false) {
        const oldState = { ...this.state };
        this.state = {
            currentData: [], filterOptions: { locations: [], islands: [], rcp2_6_values: [], rcp8_5_values: [] },
            activeFilters: { location: null, island: null, rcp2_6_inundated: null, rcp8_5_inundated: null },
            activeSqlFilter: null, isLoading: false, visiblePoints: 0, isMobileSidebarOpen: false,
            activeTab: 'filters', activeModal: null, mapInstance: null, mapBounds: null, selectedLagoonId: null
        };
        if (!silent) this.eventBus.emit('state:reset', { oldState, newState: this.state });
    }

    getState() { return JSON.parse(JSON.stringify(this.state)); }
}

export default StateManager;
