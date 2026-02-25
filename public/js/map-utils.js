// Map utility functions
class MapUtils {
  constructor(mapType = 'osm') {
    this.mapType = mapType;
    this.map = null;
    this.markers = [];
    this.geocoder = null;
  }

  // Initialize map
  async initMap(containerId, options = {}) {
    const defaultOptions = {
      center: { lat: 20.5937, lng: 78.9629 }, // Center of India
      zoom: 5
    };

    const mapOptions = { ...defaultOptions, ...options };

    if (this.mapType === 'google') {
      // Initialize Google Maps
      await this.loadGoogleMapsScript();
      this.map = new google.maps.Map(document.getElementById(containerId), {
        center: mapOptions.center,
        zoom: mapOptions.zoom,
        mapTypeControl: true,
        fullscreenControl: true,
        streetViewControl: false
      });
      this.geocoder = new google.maps.Geocoder();
    } else {
      // Initialize OpenStreetMap with Leaflet
      this.map = L.map(containerId).setView(
        [mapOptions.center.lat, mapOptions.center.lng],
        mapOptions.zoom
      );
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(this.map);
    }

    return this.map;
  }

  // Add marker to map
  addMarker(position, options = {}) {
    if (this.mapType === 'google') {
      const marker = new google.maps.Marker({
        position,
        map: this.map,
        title: options.title || '',
        draggable: options.draggable || false
      });
      this.markers.push(marker);
      return marker;
    } else {
      const marker = L.marker([position.lat, position.lng], {
        title: options.title || '',
        draggable: options.draggable || false
      }).addTo(this.map);
      this.markers.push(marker);
      return marker;
    }
  }

  // Geocode address
  async geocodeAddress(address) {
    if (this.mapType === 'google') {
      return new Promise((resolve, reject) => {
        this.geocoder.geocode({ address }, (results, status) => {
          if (status === 'OK') {
            resolve({
              lat: results[0].geometry.location.lat(),
              lng: results[0].geometry.location.lng(),
              address: results[0].formatted_address
            });
          } else {
            reject(new Error('Geocoding failed: ' + status));
          }
        });
      });
    } else {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`
        );
        const data = await response.json();
        if (data.length > 0) {
          return {
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon),
            address: data[0].display_name
          };
        }
        throw new Error('Location not found');
      } catch (error) {
        throw new Error('Geocoding failed: ' + error.message);
      }
    }
  }

  // Clear all markers
  clearMarkers() {
    if (this.mapType === 'google') {
      this.markers.forEach(marker => marker.setMap(null));
    } else {
      this.markers.forEach(marker => this.map.removeLayer(marker));
    }
    this.markers = [];
  }

  // Load Google Maps script dynamically
  loadGoogleMapsScript() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.maps) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${window.GOOGLE_MAPS_API_KEY}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Google Maps'));
      document.head.appendChild(script);
    });
  }

  // Get current location
  getCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by your browser'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          reject(new Error('Failed to get location: ' + error.message));
        }
      );
    });
  }

  // Calculate distance between two points
  calculateDistance(point1, point2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRad(point2.lat - point1.lat);
    const dLon = this.toRad(point2.lng - point1.lng);
    const lat1 = this.toRad(point1.lat);
    const lat2 = this.toRad(point2.lat);

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Convert degrees to radians
  toRad(degrees) {
    return degrees * Math.PI / 180;
  }
}

// Export the MapUtils class
window.MapUtils = MapUtils;