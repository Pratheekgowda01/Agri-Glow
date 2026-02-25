const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/maps-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/maps-combined.log' })
  ]
});

class MapsService {
  constructor() {
    this.nominatimUrl = (process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
    this.photonUrl = (process.env.PHOTON_URL || 'https://photon.komoot.io').replace(/\/$/, '');
    this.osrmUrl = (process.env.OSRM_ROUTE_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
    this.userAgent = process.env.MAPS_USER_AGENT || 'AgriGlowLocal/1.0';
  }

  async fetchJson(url, options = {}) {
    try {
      const fetch = (await import('node-fetch')).default;
      const headers = { 'User-Agent': this.userAgent, Accept: 'application/json', ...options.headers };
      const response = await fetch(url, { ...options, headers });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Request failed ${response.status}: ${text}`);
      }
      return response.json();
    } catch (error) {
      logger.error('Maps request failed', { url, error: error.message });
      throw error;
    }
  }

  async geocodeAddress(address) {
    try {
      const url = new URL(`${this.nominatimUrl}/search`);
      url.searchParams.set('q', address);
      url.searchParams.set('format', 'json');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('limit', '1');
      const data = await this.fetchJson(url.toString());
      if (Array.isArray(data) && data.length > 0) {
        const result = data[0];
        return {
          success: true,
          coordinates: [parseFloat(result.lon), parseFloat(result.lat)],
          formattedAddress: result.display_name,
          addressComponents: result.address || {},
          placeId: result.place_id,
          raw: result
        };
      }
      if (this.photonUrl) {
        const fallbackUrl = new URL(`${this.photonUrl}/search`);
        fallbackUrl.searchParams.set('q', address);
        fallbackUrl.searchParams.set('limit', '1');
        const photonData = await this.fetchJson(fallbackUrl.toString());
        if (photonData && Array.isArray(photonData.features) && photonData.features.length > 0) {
          const feature = photonData.features[0];
          return {
            success: true,
            coordinates: feature.geometry.coordinates,
            formattedAddress: feature.properties.name || address,
            addressComponents: feature.properties,
            placeId: feature.properties.osm_id || feature.properties.id,
            raw: feature
          };
        }
      }
      return { success: false, error: 'Address not found' };
    } catch (error) {
      logger.error('Geocoding failed', { address, error: error.message });
      return { success: false, error: error.message };
    }
  }

  async reverseGeocode(lat, lng) {
    try {
      const url = new URL(`${this.nominatimUrl}/reverse`);
      url.searchParams.set('lat', lat);
      url.searchParams.set('lon', lng);
      url.searchParams.set('format', 'json');
      url.searchParams.set('addressdetails', '1');
      const data = await this.fetchJson(url.toString());
      if (data) {
        return {
          success: true,
          formattedAddress: data.display_name,
          addressComponents: data.address || {},
          placeId: data.place_id,
          raw: data
        };
      }
      return { success: false, error: 'Location not found' };
    } catch (error) {
      logger.error('Reverse geocoding failed', { lat, lng, error: error.message });
      return { success: false, error: error.message };
    }
  }

  formatDistance(distance, units) {
    if (!Number.isFinite(distance)) return { value: distance, text: 'Unavailable' };
    if (units === 'imperial') {
      const miles = distance / 1609.344;
      return { value: distance, text: `${miles.toFixed(2)} mi` };
    }
    const km = distance / 1000;
    if (km >= 1) return { value: distance, text: `${km.toFixed(2)} km` };
    return { value: distance, text: `${Math.round(distance)} m` };
  }

  formatDuration(duration) {
    if (!Number.isFinite(duration)) return { value: duration, text: 'Unavailable' };
    const minutes = Math.round(duration / 60);
    if (minutes < 60) return { value: duration, text: `${minutes} min` };
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    if (remaining === 0) return { value: duration, text: `${hours} hr` };
    return { value: duration, text: `${hours} hr ${remaining} min` };
  }

  async resolveCoordinates(input) {
    if (Array.isArray(input) && input.length === 2) return [parseFloat(input[0]), parseFloat(input[1])];
    if (typeof input === 'string') {
      const result = await this.geocodeAddress(input);
      if (result.success) return result.coordinates;
    }
    throw new Error('Unable to resolve coordinates');
  }

  async getDistanceMatrix(origins, destinations, options = {}) {
    try {
      const originList = Array.isArray(origins) ? origins : [origins];
      const destinationList = Array.isArray(destinations) ? destinations : [destinations];
      const originCoords = [];
      const destinationCoords = [];
      for (const origin of originList) originCoords.push(await this.resolveCoordinates(origin));
      for (const destination of destinationList) destinationCoords.push(await this.resolveCoordinates(destination));
      const coordinates = [...originCoords, ...destinationCoords].map(([lng, lat]) => `${lng},${lat}`).join(';');
      const sources = originCoords.map((_, index) => index).join(';');
      const destIndexes = destinationCoords.map((_, index) => index + originCoords.length).join(';');
      const url = new URL(`${this.osrmUrl}/table/v1/driving/${coordinates}`);
      url.searchParams.set('annotations', 'distance,duration');
      url.searchParams.set('sources', sources);
      url.searchParams.set('destinations', destIndexes);
      const data = await this.fetchJson(url.toString());
      if (!data || !Array.isArray(data.distances) || !Array.isArray(data.durations)) {
        return { success: false, error: 'No distance data found' };
      }
      const results = [];
      data.distances.forEach((row, originIndex) => {
        row.forEach((distance, destinationIndex) => {
          const duration = data.durations[originIndex][destinationIndex];
          results.push({
            originIndex,
            destinationIndex,
            distance: this.formatDistance(distance, options.units),
            duration: this.formatDuration(duration),
            status: Number.isFinite(distance) ? 'OK' : 'ZERO_RESULTS'
          });
        });
      });
      return {
        success: true,
        results,
        originAddresses: originCoords.map(([lng, lat]) => `${lat},${lng}`),
        destinationAddresses: destinationCoords.map(([lng, lat]) => `${lat},${lng}`)
      };
    } catch (error) {
      logger.error('Distance matrix request failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  async getDirections(origin, destination, options = {}) {
    try {
      const originCoords = await this.resolveCoordinates(origin);
      const destinationCoords = await this.resolveCoordinates(destination);
      const params = new URLSearchParams();
      params.set('overview', options.overview || 'full');
      params.set('geometries', options.geometries || 'geojson');
      params.set('steps', options.steps === false ? 'false' : 'true');
      params.set('alternatives', options.alternatives ? 'true' : 'false');
      const url = `${this.osrmUrl}/route/v1/driving/${originCoords[0]},${originCoords[1]};${destinationCoords[0]},${destinationCoords[1]}?${params.toString()}`;
      const data = await this.fetchJson(url);
      if (data && Array.isArray(data.routes) && data.routes.length > 0) {
        return { success: true, routes: data.routes, waypoints: data.waypoints || [], code: data.code };
      }
      return { success: false, error: 'No routes found' };
    } catch (error) {
      logger.error('Directions request failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  async findNearbyPlaces(location, radius = 5000, type = '', keyword = '') {
    try {
      const coordinates = await this.resolveCoordinates(location);
      const lat = coordinates[1];
      const lon = coordinates[0];
      const query = keyword || type || 'market';
      const url = new URL(`${this.photonUrl}/search`);
      url.searchParams.set('lat', lat);
      url.searchParams.set('lon', lon);
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '20');
      const data = await this.fetchJson(url.toString());
      if (data && Array.isArray(data.features)) {
        const places = data.features
          .filter(feature => feature.geometry && Array.isArray(feature.geometry.coordinates))
          .map(feature => ({
            placeId: feature.properties.osm_id || feature.properties.id,
            name: feature.properties.name || feature.properties.label || query,
            vicinity: feature.properties.city || feature.properties.street || '',
            location: {
              lat: feature.geometry.coordinates[1],
              lng: feature.geometry.coordinates[0]
            },
            types: feature.properties.type ? [feature.properties.type] : [],
            distance: this.calculateDistance(lat, lon, feature.geometry.coordinates[1], feature.geometry.coordinates[0]),
            properties: feature.properties
          }))
          .filter(place => place.distance * 1000 <= radius);
        return { success: true, places, nextPageToken: null };
      }
      return { success: false, error: 'No places found' };
    } catch (error) {
      logger.error('Nearby places search failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  calculateDistance(lat1, lon1, lat2, lon2, unit = 'km') {
    const R = unit === 'km' ? 6371 : 3959;
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  async findProductsNearLocation(userCoordinates, radius = 50, products = []) {
    try {
      const [userLng, userLat] = userCoordinates;
      const productsWithDistance = [];
      products.forEach(product => {
        if (product.location && product.location.coordinates) {
          const [productLng, productLat] = product.location.coordinates;
          const distance = this.calculateDistance(userLat, userLng, productLat, productLng);
          if (distance <= radius) {
            productsWithDistance.push({
              ...product.toObject(),
              distance: Math.round(distance * 10) / 10
            });
          }
        }
      });
      productsWithDistance.sort((a, b) => a.distance - b.distance);
      return { success: true, products: productsWithDistance, totalFound: productsWithDistance.length };
    } catch (error) {
      logger.error('Error finding products near location', { error: error.message });
      return { success: false, error: error.message, products: [] };
    }
  }

  getStaticMapUrl(options = {}) {
    const base = 'https://staticmap.openstreetmap.de/staticmap.php';
    const url = new URL(base);
    const center = options.center;
    const zoom = options.zoom || 13;
    const size = options.size || '600x400';
    url.searchParams.set('zoom', zoom.toString());
    url.searchParams.set('size', size);
    if (center) {
      const [lng, lat] = Array.isArray(center) ? center : [center.lng, center.lat];
      url.searchParams.set('center', `${lat},${lng}`);
    }
    (options.markers || []).forEach(marker => {
      if (Array.isArray(marker) && marker.length === 2) {
        url.searchParams.append('markers', `${marker[1]},${marker[0]},lightblue1`);
      } else if (marker && marker.lat !== undefined && marker.lng !== undefined) {
        url.searchParams.append('markers', `${marker.lat},${marker.lng},lightblue1`);
      }
    });
    if (Array.isArray(options.path) && options.path.length > 0) {
      const pathParam = options.path.map(point => Array.isArray(point) ? `${point[1]},${point[0]}` : `${point.lat},${point.lng}`).join('|');
      url.searchParams.set('path', pathParam);
    }
    return url.toString();
  }

  isValidCoordinates(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length !== 2) return false;
    const [lng, lat] = coordinates;
    return typeof lng === 'number' && typeof lat === 'number' && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
  }

  async getPlaceDetails(placeId, fields = []) {
    try {
      const url = new URL(`${this.nominatimUrl}/lookup`);
      url.searchParams.set('format', 'json');
      url.searchParams.set('place_id', placeId);
      const data = await this.fetchJson(url.toString());
      if (Array.isArray(data) && data.length > 0) {
        const result = data[0];
        return {
          success: true,
          place: {
            name: result.display_name,
            address: result.address,
            latitude: parseFloat(result.lat),
            longitude: parseFloat(result.lon),
            raw: result
          }
        };
      }
      return { success: false, error: 'Place not found' };
    } catch (error) {
      logger.error('Place details request failed', { placeId, error: error.message });
      return { success: false, error: error.message };
    }
  }
}

module.exports = new MapsService();
