function createLocationPicker(containerId, options = {}) {
  const defaults = {
    mapType: 'osm', // or 'google'
    defaultLocation: { lat: 20.5937, lng: 78.9629 }, // Center of India
    defaultZoom: 5,
    onLocationSelect: null,
    onLocationError: null
  };

  const settings = { ...defaults, ...options };
  let mapUtils = null;
  let searchInput = null;
  let selectedLocation = null;

  async function initialize() {
    try {
      // Create container elements
      const container = document.getElementById(containerId);
      container.innerHTML = `
        <div class="location-picker">
          <div class="search-box mb-3">
            <div class="input-group">
              <input type="text" class="form-control" placeholder="Search location..." id="${containerId}-search">
              <button class="btn btn-outline-primary" type="button" id="${containerId}-current-location">
                <i class="fas fa-location-arrow"></i>
              </button>
            </div>
          </div>
          <div id="${containerId}-map" style="height: 400px;" class="rounded border mb-3"></div>
          <div class="selected-location" id="${containerId}-selected-location"></div>
        </div>
      `;

      // Initialize map
      mapUtils = new MapUtils(settings.mapType);
      await mapUtils.initMap(`${containerId}-map`, {
        center: settings.defaultLocation,
        zoom: settings.defaultZoom
      });

      // Set up search input
      searchInput = document.getElementById(`${containerId}-search`);
      setupSearchAutocomplete();

      // Set up current location button
      const currentLocationBtn = document.getElementById(`${containerId}-current-location`);
      currentLocationBtn.addEventListener('click', handleCurrentLocation);

      // Set up map click handler
      if (settings.mapType === 'google') {
        mapUtils.map.addListener('click', handleMapClick);
      } else {
        mapUtils.map.on('click', handleMapClick);
      }
    } catch (error) {
      console.error('Failed to initialize location picker:', error);
      if (settings.onLocationError) {
        settings.onLocationError(error);
      }
    }
  }

  async function setupSearchAutocomplete() {
    let timeoutId = null;
    
    searchInput.addEventListener('input', async (e) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(async () => {
        const query = e.target.value.trim();
        if (query.length < 3) return;

        try {
          const response = await fetch(`/api/maps/suggest?q=${encodeURIComponent(query)}`);
          if (!response.ok) throw new Error('Search failed');

          const suggestions = await response.json();
          showSearchSuggestions(suggestions);
        } catch (error) {
          console.error('Search failed:', error);
        }
      }, 300);
    });
  }

  function showSearchSuggestions(suggestions) {
    // Remove existing suggestions
    const existingSuggestions = document.getElementById(`${containerId}-suggestions`);
    if (existingSuggestions) {
      existingSuggestions.remove();
    }

    if (!suggestions.length) return;

    // Create suggestions dropdown
    const suggestionsList = document.createElement('div');
    suggestionsList.id = `${containerId}-suggestions`;
    suggestionsList.className = 'suggestions-list';
    
    suggestions.forEach(suggestion => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.innerHTML = `${suggestion.name}<br><small>${suggestion.address}</small>`;
      
      item.addEventListener('click', () => {
        selectLocation({ lat: suggestion.lat, lng: suggestion.lon }, suggestion.name);
        suggestionsList.remove();
        searchInput.value = suggestion.name;
      });

      suggestionsList.appendChild(item);
    });

    // Position and show suggestions
    const searchBox = searchInput.parentElement;
    searchBox.appendChild(suggestionsList);
  }

  async function handleCurrentLocation() {
    try {
      const location = await mapUtils.getCurrentLocation();
      const response = await fetch(`/api/maps/reverse?lat=${location.lat}&lon=${location.lng}`);
      if (!response.ok) throw new Error('Reverse geocoding failed');

      const data = await response.json();
      selectLocation(location, data.display_name);
    } catch (error) {
      console.error('Failed to get current location:', error);
      if (settings.onLocationError) {
        settings.onLocationError(error);
      }
    }
  }

  async function handleMapClick(event) {
    let location;
    if (settings.mapType === 'google') {
      location = {
        lat: event.latLng.lat(),
        lng: event.latLng.lng()
      };
    } else {
      location = {
        lat: event.latlng.lat,
        lng: event.latlng.lng
      };
    }

    try {
      const response = await fetch(`/api/maps/reverse?lat=${location.lat}&lon=${location.lng}`);
      if (!response.ok) throw new Error('Reverse geocoding failed');

      const data = await response.json();
      selectLocation(location, data.display_name);
    } catch (error) {
      console.error('Failed to reverse geocode location:', error);
      if (settings.onLocationError) {
        settings.onLocationError(error);
      }
    }
  }

  function selectLocation(location, address) {
    selectedLocation = {
      lat: location.lat,
      lng: location.lng,
      address: address
    };

    // Update map
    mapUtils.clearMarkers();
    mapUtils.addMarker(location);
    mapUtils.map.setCenter ? 
      mapUtils.map.setCenter(location) : 
      mapUtils.map.setView([location.lat, location.lng]);

    // Update display
    const selectedLocationDiv = document.getElementById(`${containerId}-selected-location`);
    selectedLocationDiv.innerHTML = `
      <div class="alert alert-info">
        <strong>Selected Location:</strong><br>
        ${address}<br>
        <small>Coordinates: ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}</small>
      </div>
    `;

    // Callback
    if (settings.onLocationSelect) {
      settings.onLocationSelect(selectedLocation);
    }
  }

  function getSelectedLocation() {
    return selectedLocation;
  }

  // Initialize the component
  initialize();

  // Return public methods
  return {
    getSelectedLocation,
    selectLocation: (location, address) => selectLocation(location, address)
  };
}

// Export the component
window.createLocationPicker = createLocationPicker;