// Import Mapbox and D3 as ESM modules
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Set your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoicmF5eWFuNzc3NyIsImEiOiJjbWFyZmt3YXEwYTZkMnJwcWRiZmc5ZGczIn0.Txwl9wTWGnhlvYnZF6ahTw';

// Helper functions
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Bucketing for performance
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) return tripsByMinute.flat();

  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    return tripsByMinute.slice(minMinute).concat(tripsByMinute.slice(0, maxMinute)).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    v => v.length,
    d => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    v => v.length,
    d => d.end_station_id
  );

  return stations.map((station) => {
    const id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Create the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

map.on('load', async () => {
  // Bike lanes (Boston + Cambridge)
  const bikeLaneStyle = {
    'line-color': '#32D400',
    'line-width': 4,
    'line-opacity': 0.6,
  };

  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addLayer({ id: 'bike-lanes-boston', type: 'line', source: 'boston_route', paint: bikeLaneStyle });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });
  map.addLayer({ id: 'bike-lanes-cambridge', type: 'line', source: 'cambridge_route', paint: bikeLaneStyle });

  // Load stations
  let stations = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
  stations = stations.data.stations.filter(
    (d) => d.lat && d.lon && !isNaN(+d.lat) && !isNaN(+d.lon)
  );

  // Load trip data and bucket by minute
  let trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      const startMin = minutesSinceMidnight(trip.started_at);
      const endMin = minutesSinceMidnight(trip.ended_at);
      departuresByMinute[startMin].push(trip);
      arrivalsByMinute[endMin].push(trip);
      return trip;
    }
  );

  // Reusable scale
  const radiusScale = d3.scaleSqrt().range([0, 25]);

  const stationFlow = d3.scaleQuantize()
  .domain([0, 1])
  .range([0, 0.5, 1]); // More arrivals → 0, Balanced → 0.5, More departures → 1


  // Project lat/lon to screen coordinates
  function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
  }

  // Overlay SVG
  const svg = d3.select('#map').select('svg');

  // Initial traffic computation
  stations = computeStationTraffic(stations);

  // Initial radius domain
  radiusScale.domain([0, d3.max(stations, d => d.totalTraffic)]);

  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', d => radiusScale(d.totalTraffic))
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('fill-opacity', 0.6)
    .style('--departure-ratio', d =>
        stationFlow(d.departures / d.totalTraffic || 0)
      )
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    });

  // Reposition circles
  function updatePositions() {
    circles
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // SLIDER INTERACTION
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(stations, timeFilter);

    // Scale adjustment for filtering
    timeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    radiusScale.domain([0, d3.max(filteredStations, d => d.totalTraffic)]);

    circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', d =>
        stationFlow(d.departures / d.totalTraffic || 0)
      );  
  }

  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }
    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay(); // initial
});











