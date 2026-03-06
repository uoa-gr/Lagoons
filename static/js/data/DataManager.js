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
        this.allOptions = null;
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
            p_name_en:          filters.name          || null,
            p_location_en:      filters.location      || null,
            p_island_en:        filters.island        || null,
            p_rcp2_6_inundated: filters.rcp2_6_inundated || null,
            p_rcp8_5_inundated: filters.rcp8_5_inundated || null
        };
        const cacheKey = `markers:${JSON.stringify(params)}`;
        const cached = this.cacheManager.get(cacheKey);
        if (cached) return cached;

        let data;
        try {
            data = await this.fetchAllRecords('api_lagoons_markers', params);
        } catch (error) {
            const legacyParams = {
                p_location_en: params.p_location_en,
                p_island_en: params.p_island_en,
                p_rcp2_6_inundated: params.p_rcp2_6_inundated,
                p_rcp8_5_inundated: params.p_rcp8_5_inundated
            };
            data = await this.fetchAllRecords('api_lagoons_markers', legacyParams);
            if (params.p_name_en) data = data.filter(r => r.name_en === params.p_name_en);

            if (window.DEBUG_MODE) {
                console.warn('DataManager: Falling back to legacy api_lagoons_markers signature', error);
            }
        }

        this.cacheManager.set(cacheKey, data, this.CACHE_TTL);
        this.stateManager.set('currentData', data);
        return data;
    }

    async fetchPolygonData(filters = {}) {
        const params = {
            p_name_en:          filters.name          || null,
            p_location_en:      filters.location      || null,
            p_island_en:        filters.island        || null,
            p_rcp2_6_inundated: filters.rcp2_6_inundated || null,
            p_rcp8_5_inundated: filters.rcp8_5_inundated || null
        };
        const cacheKey = `polygons:${JSON.stringify(params)}`;
        const cached = this.cacheManager.get(cacheKey);
        if (cached) return cached;

        let data;
        try {
            data = await this.fetchAllRecords('api_lagoons_polygons', params);
        } catch (error) {
            const legacyParams = {
                p_location_en: params.p_location_en,
                p_island_en: params.p_island_en,
                p_rcp2_6_inundated: params.p_rcp2_6_inundated,
                p_rcp8_5_inundated: params.p_rcp8_5_inundated
            };
            data = await this.fetchAllRecords('api_lagoons_polygons', legacyParams);
            if (params.p_name_en) data = data.filter(r => r.name_en === params.p_name_en);

            if (window.DEBUG_MODE) {
                console.warn('DataManager: Falling back to legacy api_lagoons_polygons signature', error);
            }
        }

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

    async fetchLagoonGeometryById(id) {
        const cacheKey = `geometry:${id}`;
        const cached = this.cacheManager.get(cacheKey);
        if (cached) return cached;

        try {
            const { data, error } = await this.supabase.rpc('api_lagoons_preview_geometry', { p_id: id });
            if (error) throw error;
            const geometry = data?.[0] || null;
            if (geometry) this.cacheManager.set(cacheKey, geometry, this.CACHE_TTL);
            return geometry;
        } catch (error) {
            if (window.DEBUG_MODE) {
                console.warn(`DataManager: preview geometry RPC failed for lagoon ${id}`, error);
            }
            return null;
        }
    }

    async fetchFilterOptions(activeFilters = {}) {
        const cacheKey = `filterOptions:${JSON.stringify(activeFilters)}`;
        const cached = this.cacheManager.get(cacheKey);
        if (cached) { this.eventBus.emit('filterOptions:loaded', { options: cached, allOptions: this.allOptions || cached }); return cached; }

        let options;
        try {
            const [nameResult, locResult, islResult, rcp26Result, rcp85Result] = await Promise.all([
                this.supabase.rpc('api_lagoons_filter_names', {
                    p_location_en: activeFilters.location || null,
                    p_island_en: activeFilters.island || null,
                    p_rcp2_6_inundated: activeFilters.rcp2_6_inundated || null,
                    p_rcp8_5_inundated: activeFilters.rcp8_5_inundated || null
                }),
                this.supabase.rpc('api_lagoons_filter_locations', {
                    p_name_en: activeFilters.name || null,
                    p_island_en: activeFilters.island || null,
                    p_rcp2_6_inundated: activeFilters.rcp2_6_inundated || null,
                    p_rcp8_5_inundated: activeFilters.rcp8_5_inundated || null
                }),
                this.supabase.rpc('api_lagoons_filter_islands', {
                    p_name_en: activeFilters.name || null,
                    p_location_en: activeFilters.location || null,
                    p_rcp2_6_inundated: activeFilters.rcp2_6_inundated || null,
                    p_rcp8_5_inundated: activeFilters.rcp8_5_inundated || null
                }),
                this.supabase.rpc('api_lagoons_filter_rcp26', {
                    p_name_en: activeFilters.name || null,
                    p_location_en: activeFilters.location || null,
                    p_island_en: activeFilters.island || null,
                    p_rcp8_5_inundated: activeFilters.rcp8_5_inundated || null
                }),
                this.supabase.rpc('api_lagoons_filter_rcp85', {
                    p_name_en: activeFilters.name || null,
                    p_location_en: activeFilters.location || null,
                    p_island_en: activeFilters.island || null,
                    p_rcp2_6_inundated: activeFilters.rcp2_6_inundated || null
                })
            ]);

            const rpcError =
                nameResult.error || locResult.error || islResult.error || rcp26Result.error || rcp85Result.error;
            if (rpcError) throw rpcError;

            const nameData = await this.fetchLagoonData(activeFilters);
            options = {
                names:         this.buildNameOptions(nameData),
                locations:     (locResult.data   || []).map(r => r.location_en),
                islands:       (islResult.data   || []).map(r => r.island_en),
                rcp2_6_values: (rcp26Result.data || []).map(r => r.rcp2_6_inundated),
                rcp8_5_values: (rcp85Result.data || []).map(r => r.rcp8_5_inundated)
            };
        } catch (error) {
            if (window.DEBUG_MODE) {
                console.warn('DataManager: Falling back to client-side filter options generation', error);
            }

            const data = await this.fetchLagoonData(activeFilters);
            const toUnique = arr => [...new Set(arr.filter(Boolean))].sort();
            options = {
                names:         this.buildNameOptions(data),
                locations:     toUnique(data.map(r => r.location_en)),
                islands:       toUnique(data.map(r => r.island_en)),
                rcp2_6_values: toUnique(data.map(r => r.rcp2_6_inundated)),
                rcp8_5_values: toUnique(data.map(r => r.rcp8_5_inundated))
            };
        }

        // Store unfiltered options as the "all options" baseline for badge counts
        const hasFilters = Object.values(activeFilters).some(v => v !== null && v !== undefined && v !== '');
        if (!hasFilters) {
            this.allOptions = options;
        }

        this.cacheManager.set(cacheKey, options, this.CACHE_TTL);
        this.stateManager.set('filterOptions', options);
        this.eventBus.emit('filterOptions:loaded', { options, allOptions: this.allOptions || options });
        return options;
    }

    emitFilterOptionsFromData(data) {
        const toUnique = arr => [...new Set(arr.filter(Boolean))].sort();
        const options = {
            names:         this.buildNameOptions(data),
            locations:     toUnique(data.map(r => r.location_en)),
            islands:       toUnique(data.map(r => r.island_en)),
            rcp2_6_values: toUnique(data.map(r => r.rcp2_6_inundated)),
            rcp8_5_values: toUnique(data.map(r => r.rcp8_5_inundated))
        };
        if (!this.allOptions) {
            this.allOptions = options;
        }
        this.stateManager.set('filterOptions', options);
        this.eventBus.emit('filterOptions:loaded', { options, allOptions: this.allOptions });
    }

    buildNameOptions(data = []) {
        const seen = new Set();
        const list = [];

        data.forEach(row => {
            const name = row?.name_en ? String(row.name_en).trim() : '';
            if (!name) return;

            const location = row?.location_en ? String(row.location_en).trim() : '';
            const key = `${name}|${location}`;
            if (seen.has(key)) return;
            seen.add(key);

            list.push({
                value: name,
                location,
                label: location ? `${name} (${location})` : name
            });
        });

        list.sort((a, b) => a.label.localeCompare(b.label));
        return list;
    }
}

export default DataManager;
