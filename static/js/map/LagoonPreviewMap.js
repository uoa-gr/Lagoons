/**
 * LagoonPreviewMap - Renders non-interactive mini Leaflet maps for lagoon previews
 */

import { safeJsonParse } from '../utils/helpers.js';

const DEFAULT_CENTER = [39.0742, 21.8243];
const DEFAULT_ZOOM = 7;
const POINT_ZOOM = 13;
const MAX_PREVIEW_ZOOM = 15;

class LagoonPreviewMap {
    constructor() {
        this.instances = new WeakMap();
    }

    render(container, lagoon = {}, options = {}) {
        if (!container || typeof L === 'undefined') return null;

        this.destroy(container);

        const map = L.map(container, {
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
            tap: false,
            touchZoom: false
        });

        this.instances.set(container, map);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
        }).addTo(map);

        const polygonGeoJson = this.normalizeGeoJson(lagoon.geojson);
        let bounds = null;

        if (polygonGeoJson) {
            try {
                const polygon = L.geoJSON(polygonGeoJson, {
                    style: {
                        color: '#1e3a5f',
                        weight: 2.5,
                        fillColor: '#1d4ed8',
                        fillOpacity: 0.35
                    }
                }).addTo(map);

                bounds = polygon.getBounds();
            } catch (error) {
                if (window.DEBUG_MODE) {
                    console.warn('LagoonPreviewMap: Failed to draw polygon preview', error);
                }
            }
        }

        const lat = parseFloat(lagoon.centroid_lat ?? lagoon.centroidLat);
        const lng = parseFloat(lagoon.centroid_lng ?? lagoon.centroidLng);

        if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
            L.circleMarker([lat, lng], {
                radius: 4,
                color: '#ffffff',
                weight: 1.2,
                fillColor: '#dc2626',
                fillOpacity: 1
            }).addTo(map);

            if (!bounds || !bounds.isValid()) {
                bounds = L.latLngBounds([lat, lng], [lat, lng]);
            }
        }

        this.fitMap(map, bounds, options);

        requestAnimationFrame(() => {
            if (map.getContainer()) {
                map.invalidateSize(false);
            }
        });

        return map;
    }

    destroy(container) {
        if (!container) return;

        const map = this.instances.get(container);
        if (map) {
            map.remove();
            this.instances.delete(container);
        }

        container.textContent = '';
    }

    normalizeGeoJson(value) {
        if (!value) return null;
        if (typeof value === 'string') return safeJsonParse(value, null);
        return value;
    }

    fitMap(map, bounds, options = {}) {
        if (bounds && bounds.isValid()) {
            const ne = bounds.getNorthEast();
            const sw = bounds.getSouthWest();
            const pointBounds = ne.lat === sw.lat && ne.lng === sw.lng;

            if (pointBounds) {
                map.setView(bounds.getCenter(), options.pointZoom || POINT_ZOOM);
            } else {
                map.fitBounds(bounds.pad(0.15), {
                    animate: false,
                    maxZoom: options.maxZoom || MAX_PREVIEW_ZOOM,
                    padding: [4, 4]
                });
            }
            return;
        }

        map.setView(DEFAULT_CENTER, options.defaultZoom || DEFAULT_ZOOM);
    }
}

export default LagoonPreviewMap;
