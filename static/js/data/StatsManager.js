/**
 * StatsManager - Compute and display lagoon statistics
 */

class StatsManager {
    constructor(eventBus, dataManager) {
        this.eventBus = eventBus;
        this.dataManager = dataManager;
    }

    init() {
        this.eventBus.on('data:loaded', ({ count }) => {
            const data = this.dataManager?.stateManager?.get('currentData') || [];
            if (data.length) this.calculateFromData(data);
        });
        if (window.DEBUG_MODE) console.log('✅ StatsManager: Initialized');
    }

    calculateFromData(data) {
        if (!Array.isArray(data) || data.length === 0) {
            this.updateDisplay({ total: 0, locations: 0, rcp26: 0, rcp85: 0 });
            return;
        }
        const total     = data.length;
        const locations = new Set(data.map(r => r.location_en).filter(Boolean)).size;
        const rcp26     = data.filter(r => r.rcp2_6_inundated?.toLowerCase() === 'yes').length;
        const rcp85     = data.filter(r => r.rcp8_5_inundated?.toLowerCase() === 'yes').length;
        const stats = { total, locations, rcp26, rcp85 };
        this.updateDisplay(stats);
        this.eventBus.emit('stats:updated', stats);
    }

    updateDisplay(stats) {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('stat-total',     stats.total     ?? '-');
        set('stat-locations', stats.locations  ?? '-');
        set('stat-rcp26',     stats.rcp26      ?? '-');
        set('stat-rcp85',     stats.rcp85      ?? '-');
    }
}

export default StatsManager;
