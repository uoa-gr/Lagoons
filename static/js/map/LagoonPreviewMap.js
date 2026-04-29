/**
 * LagoonPreviewMap - Renders non-interactive mini Leaflet maps for lagoon previews
 */

import { safeJsonParse } from '../utils/helpers.js';

const DEFAULT_CENTER = [39.0742, 21.8243];
const DEFAULT_ZOOM = 7;
const POINT_ZOOM = 14;
const MAX_PREVIEW_ZOOM = 17;

class LagoonPreviewMap {
    constructor() {
        this.instances = new WeakMap();
    }

    render(container, lagoon = {}, options = {}) {
        if (!container || typeof L === 'undefined') return null;

        this.destroy(container);

        const locator = !!options.locator;

        const map = L.map(container, {
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
            tap: false,
            touchZoom: false,
            zoomSnap: locator ? 0.25 : 1
        });

        this.instances.set(container, map);

        // No-labels variant of CartoDB Positron — country/city names removed for a clean preview
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
            attribution: '',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(map);

        const lat = parseFloat(lagoon.centroid_lat ?? lagoon.centroidLat);
        const lng = parseFloat(lagoon.centroid_lng ?? lagoon.centroidLng);
        const hasPoint = !Number.isNaN(lat) && !Number.isNaN(lng);

        // Locator mode: fixed view (or fitted to a passed bbox), just a dot
        if (locator) {
            if (Array.isArray(options.fitBounds) && options.fitBounds.length === 2) {
                map.fitBounds(options.fitBounds, {
                    animate: false,
                    padding: options.fitPadding || [4, 4]
                });
            } else {
                map.setView(options.center || [39, 23], options.zoom ?? 5);
            }
            if (hasPoint) {
                L.circleMarker([lat, lng], {
                    radius: 5,
                    color: '#ffffff',
                    weight: 1.5,
                    fillColor: '#b91c1c',
                    fillOpacity: 1
                }).addTo(map);
            }
            // Use both rAF and a setTimeout fallback — rAF can be throttled when the
            // host modal is mid-open transition.
            const ensureSized = () => map.getContainer() && map.invalidateSize(false);
            requestAnimationFrame(ensureSized);
            setTimeout(ensureSized, 50);
            return map;
        }

        // Detail mode: polygon (if available) and bounds-fit
        const polygonGeoJson = this.normalizeGeoJson(lagoon.geojson);
        let bounds = null;

        if (polygonGeoJson) {
            try {
                const polygon = L.geoJSON(polygonGeoJson, {
                    style: { color: '#1e3a5f', weight: 3, fillColor: '#1d4ed8', fillOpacity: 0.4 }
                }).addTo(map);
                bounds = polygon.getBounds();
            } catch (error) {
                if (window.DEBUG_MODE) console.warn('LagoonPreviewMap: Failed to draw polygon', error);
            }
        }

        if (hasPoint && !bounds) {
            L.circleMarker([lat, lng], {
                radius: 4, color: '#ffffff', weight: 1.2,
                fillColor: '#dc2626', fillOpacity: 1
            }).addTo(map);
            bounds = L.latLngBounds([lat, lng], [lat, lng]);
        }

        this.fitMap(map, bounds, options);

        requestAnimationFrame(() => map.getContainer() && map.invalidateSize(false));
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
                map.fitBounds(bounds, {
                    animate: false,
                    maxZoom: options.maxZoom || MAX_PREVIEW_ZOOM,
                    padding: [6, 6]
                });
            }
            return;
        }

        map.setView(DEFAULT_CENTER, options.defaultZoom || DEFAULT_ZOOM);
    }
}

export default LagoonPreviewMap;
