const express = require('express');
const router = express.Router();
const { check, validationResult } = require('express-validator');
const winston = require('winston');
const axios = require('axios');
const NodeCache = require('node-cache');

// Initialize logger
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

// Initialize cache
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

const OSM_NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const OSM_PHOTON_URL = process.env.PHOTON_URL || 'https://photon.komoot.io';
const MAPS_USER_AGENT = process.env.MAPS_USER_AGENT || 'AgriGlowLocal/1.0';

// Geocoding endpoint
router.get('/geocode', [
  check('address').trim().not().isEmpty().withMessage('Address is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { address } = req.query;
    const cacheKey = `geocode:${address}`;
    
    // Check cache first
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return res.json(cachedResult);
    }

    const response = await axios.get(`${OSM_NOMINATIM_URL}/search`, {
      params: {
        q: address,
        format: 'json',
        limit: 1
      },
      headers: {
        'User-Agent': MAPS_USER_AGENT
      }
    });

    if (response.data && response.data.length > 0) {
      const result = {
        lat: parseFloat(response.data[0].lat),
        lon: parseFloat(response.data[0].lon),
        display_name: response.data[0].display_name
      };

      // Cache the result
      cache.set(cacheKey, result);
      res.json(result);
    } else {
      res.status(404).json({ error: 'Location not found' });
    }
  } catch (error) {
    logger.error('Geocoding failed', { error: error.message });
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

// Reverse geocoding endpoint
router.get('/reverse', [
  check('lat').isFloat().withMessage('Invalid latitude'),
  check('lon').isFloat().withMessage('Invalid longitude'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { lat, lon } = req.query;
    const cacheKey = `reverse:${lat},${lon}`;
    
    // Check cache first
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return res.json(cachedResult);
    }

    const response = await axios.get(`${OSM_NOMINATIM_URL}/reverse`, {
      params: {
        lat,
        lon,
        format: 'json'
      },
      headers: {
        'User-Agent': MAPS_USER_AGENT
      }
    });

    if (response.data) {
      // Cache the result
      cache.set(cacheKey, response.data);
      res.json(response.data);
    } else {
      res.status(404).json({ error: 'Location not found' });
    }
  } catch (error) {
    logger.error('Reverse geocoding failed', { error: error.message });
    res.status(500).json({ error: 'Reverse geocoding failed' });
  }
});

// Location suggestions endpoint
router.get('/suggest', [
  check('q').trim().not().isEmpty().withMessage('Search query is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { q } = req.query;
    const cacheKey = `suggest:${q}`;
    
    // Check cache first
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return res.json(cachedResult);
    }

    const response = await axios.get(`${OSM_PHOTON_URL}/api`, {
      params: {
        q,
        limit: 10
      },
      headers: {
        'User-Agent': MAPS_USER_AGENT
      }
    });

    if (response.data && response.data.features) {
      const suggestions = response.data.features.map(feature => ({
        name: feature.properties.name,
        lat: feature.geometry.coordinates[1],
        lon: feature.geometry.coordinates[0],
        address: feature.properties.street || feature.properties.city || feature.properties.country
      }));

      // Cache the result
      cache.set(cacheKey, suggestions);
      res.json(suggestions);
    } else {
      res.status(404).json({ error: 'No suggestions found' });
    }
  } catch (error) {
    logger.error('Location suggestion failed', { error: error.message });
    res.status(500).json({ error: 'Location suggestion failed' });
  }
});

module.exports = router;