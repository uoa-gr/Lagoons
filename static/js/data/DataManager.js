/**
 * DataManager - Supabase RPC calls for Greek Lagoons
 */

class DataManager {
    constructor(eventBus, cacheManager, stateManager) {
        this.eventBus = eventBus;
        this.cacheManager = cacheManager;
        this.stateManager = stateManager;
        this.supabase = null;
        this.BATCH_SIZE = 1000;
        this.CACHE_TTL = 5 * 60 * 1000;
    }

    async init() {
        if (!window.supabaseClient) { console.error('DataManager: Supabase client not initialized'); return false; }
        this.supabase = window.supabaseClient;
        try {
            const { error } = await this.supabase.rpc('api_lagoons_count');
            if (error) throw error;
            if (window.DEBUG_MODE) console.log('✅ DataManager: Connected to Supabase');
            return true;
        } catch (error) {
            console.error('DataManager: Connection test failed', error);
            return false;
        }
    }

    async fetchAllRecords(rpcName, params = {}) {
        const allRecords = [];
        let offset = 0;
        let hasMore = true;
        while (hasMore) {
            const { data, error } = await this.supabase.rpc(rpcName, params, { count: 'exact', range: [offset, offset + this.BATCH_SIZE - 1] });
            if (error) throw error;
            if (!data || data.length === 0) break;
            allRecords.push(...data);
            hasMore = data.length === this.BATCH_SIZE;
            offset += this.BATCH_SIZE;
        }
        return allRecords;
    }

    async fetchLagoonData(filters = {}) {
        const params = {
            p_location_en:      filters.location      || null,
            p_island_en:        filters.island        || null,
            p_rcp2_6_inundated: filters.rcp2_6_inundated || null,
            p_rcp8_5_inundated: filters.rcp8_5_inundated || null
        };
        const cacheKey = `markers:${JSON.stringify(params)}`;
        const cached = this.cacheManager.get(cacheKey);
        if (cached) return cached;
        const data = await this.fetchAllRecords('api_lagoons_markers', params);
        this.cacheManager.set(cacheKey, data, this.CACHE_TTL);
        this.stateManager.set('currentData', data);
        return data;
    }

    async fetchPolygonData(filters = {}) {
        const params = {
            p_location_en:      filters.location      || null,
            p_island_en:        filters.island        || null,
            p_rcp2_6_inundated: filters.rcp2_6_inundated || null,
            p_rcp8_5_inundated: filters.rcp8_5_inundated || null
        };
        const cacheKey = `polygons:${JSON.stringify(params)}`;
        const cached = this.cacheManager.get(cacheKey);
        if (cached) return cached;
        const data = await this.fetchAllRecords('api_lagoons_polygons', params);
        this.cacheManager.set(cacheKey, data, this.CACHE_TTL);
        return data;
    }

    async fetchLagoonDetails(id) {
        const cacheKey = `details:${id}`;
        const cached = this.cacheManager.get(cacheKey);
        if (cached) return cached;
        const { data, error } = await this.supabase.rpc('api_lagoons_details', { p_id: id });
        if (error) throw error;
        const record = data?.[0] || null;
        if (record) this.cacheManager.set(cacheKey, record, this.CACHE_TTL);
        return record;
    }

    async fetchFilterOptions(activeFilters = {}) {
        const cacheKey = `filterOptions:${JSON.stringify(activeFilters)}`;
        const cached = this.cacheManager.get(cacheKey);
        if (cached) { this.eventBus.emit('filterOptions:loaded', { options: cached }); return cached; }

        const [locResult, islResult, rcp26Result, rcp85Result] = await Promise.all([
            this.supabase.rpc('api_lagoons_filter_locations', { p_island_en: activeFilters.island || null, p_rcp2_6_inundated: activeFilters.rcp2_6_inundated || null, p_rcp8_5_inundated: activeFilters.rcp8_5_inundated || null }),
            this.supabase.rpc('api_lagoons_filter_islands',   { p_location_en: activeFilters.location || null, p_rcp2_6_inundated: activeFilters.rcp2_6_inundated || null, p_rcp8_5_inundated: activeFilters.rcp8_5_inundated || null }),
            this.supabase.rpc('api_lagoons_filter_rcp26',     { p_location_en: activeFilters.location || null, p_island_en: activeFilters.island || null, p_rcp8_5_inundated: activeFilters.rcp8_5_inundated || null }),
            this.supabase.rpc('api_lagoons_filter_rcp85',     { p_location_en: activeFilters.location || null, p_island_en: activeFilters.island || null, p_rcp2_6_inundated: activeFilters.rcp2_6_inundated || null })
        ]);

        const options = {
            locations:     (locResult.data   || []).map(r => r.location_en),
            islands:       (islResult.data   || []).map(r => r.island_en),
            rcp2_6_values: (rcp26Result.data || []).map(r => r.rcp2_6_inundated),
            rcp8_5_values: (rcp85Result.data || []).map(r => r.rcp8_5_inundated)
        };

        this.cacheManager.set(cacheKey, options, this.CACHE_TTL);
        this.stateManager.set('filterOptions', options);
        this.eventBus.emit('filterOptions:loaded', { options });
        return options;
    }

    emitFilterOptionsFromData(data) {
        const toUnique = arr => [...new Set(arr.filter(Boolean))].sort();
        const options = {
            locations:     toUnique(data.map(r => r.location_en)),
            islands:       toUnique(data.map(r => r.island_en)),
            rcp2_6_values: toUnique(data.map(r => r.rcp2_6_inundated)),
            rcp8_5_values: toUnique(data.map(r => r.rcp8_5_inundated))
        };
        this.stateManager.set('filterOptions', options);
        this.eventBus.emit('filterOptions:loaded', { options });
    }
}

export default DataManager;
