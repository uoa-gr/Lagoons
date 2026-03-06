/**
 * MarkerManager - Centroid dot markers for Greek Lagoons
 */

class MarkerManager {
    constructor(map, eventBus, stateManager) {
        this.map = map;
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.clusterGroup = null;
        this.markers = [];
    }

    init() {
        this.clusterGroup = L.markerClusterGroup({
            maxClusterRadius: 60,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: true,
            iconCreateFunction(cluster) {
                const count = cluster.getChildCount();
                let size = 'small';
                if (count >= 100) size = 'large';
                else if (count >= 10) size = 'medium';
                return L.divIcon({
                    html: `<div class="cluster-icon cluster-${size}"><span>${count}</span></div>`,
                    className: '',
                    iconSize: L.point(40, 40)
                });
            }
        });
        this.map.addLayer(this.clusterGroup);
        if (window.DEBUG_MODE) console.log('✅ MarkerManager: Initialized');
    }

    updateMarkers(data) {
        this.clusterGroup.clearLayers();
        this.markers = [];
        if (!data || data.length === 0) { this.eventBus.emit('markers:updated', { count: 0 }); return; }
        data.forEach(lagoon => {
            const lat = lagoon.centroid_lat;
            const lng = lagoon.centroid_lng;
            if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return;
            const marker = this.createMarker(lagoon);
            this.markers.push(marker);
            this.clusterGroup.addLayer(marker);
        });
        this.eventBus.emit('markers:updated', { count: this.markers.length });
    }

    createMarker(lagoon) {
        const icon = L.divIcon({
            className: '',
            html: '<div class="lagoon-marker"></div>',
            iconSize: [18, 18],
            iconAnchor: [9, 9]
        });
        const marker = L.marker([lagoon.centroid_lat, lagoon.centroid_lng], { icon });

        const rcp26 = lagoon.rcp2_6_inundated ? lagoon.rcp2_6_inundated.toUpperCase() : '-';
        const rcp85 = lagoon.rcp8_5_inundated ? lagoon.rcp8_5_inundated.toUpperCase() : '-';
        const area  = lagoon.area_km2 != null ? `${parseFloat(lagoon.area_km2).toFixed(2)} km²` : '-';

        marker.bindTooltip(`
            <div class="marker-tooltip">
                <div class="tooltip-name">${lagoon.name_en || 'Unnamed'}</div>
                <div class="tooltip-row"><span class="tooltip-label">Location:</span> ${lagoon.location_en || '-'}</div>
                <div class="tooltip-row"><span class="tooltip-label">Island:</span> ${lagoon.island_en || '-'}</div>
                <div class="tooltip-row"><span class="tooltip-label">Area:</span> ${area}</div>
                <div class="tooltip-row"><span class="tooltip-label">RCP 2.6:</span> ${rcp26}</div>
                <div class="tooltip-row"><span class="tooltip-label">RCP 8.5:</span> ${rcp85}</div>
            </div>
        `, { className: 'custom-tooltip', direction: 'top', offset: [0, -10] });

        marker.on('click', () => this.eventBus.emit('marker:clicked', { lagoonId: lagoon.id }));
        return marker;
    }

    getMarkers()  { return this.markers; }
    clearMarkers() { this.clusterGroup?.clearLayers(); this.markers = []; }
}

export default MarkerManager;
