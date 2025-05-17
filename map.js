// Import Mapbox and D3 as ESM modules
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Set your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoicmF5eWFuNzc3NyIsImEiOiJjbWFyZmt3YXEwYTZkMnJwcWRiZmc5ZGczIn0.Txwl9wTWGnhlvYnZF6ahTw';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Shared paint style for bike lanes
const bikeLaneStyle = {
  'line-color': '#32D400',
  'line-width': 4,
  'line-opacity': 0.6,
};

// Helper function to convert lon/lat to screen coordinates
function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
  }  
  

// Main map load logic
map.on('load', async () => {
  // --- Boston Bike Lanes ---
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle,
  });

  // --- Cambridge Bike Lanes ---
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle,
  });

  // --- BlueBike Stations ---
  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const jsonData = await d3.json(jsonurl);

    let stations = jsonData.data.stations.filter(
        (d) => d.lat && d.lon && !isNaN(+d.lat) && !isNaN(+d.lon)
      );      
      
      console.log('Raw station example:', jsonData.data.stations[0]);

      const trips = await d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv');
      console.log('✅ Loaded Trips:', trips.length);

      const departures = d3.rollup(
        trips,
        v => v.length,
        d => d.start_station_id
      );
      
      const arrivals = d3.rollup(
        trips,
        v => v.length,
        d => d.end_station_id
      );

      stations = stations.map((station) => {
        const id = station.short_name; // this is used in the CSV as station_id
        station.arrivals = arrivals.get(id) ?? 0;
        station.departures = departures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
      });
      
      console.log('✅ Updated Stations with Traffic:', stations);

      

    // Select the overlaid SVG
    const svg = d3.select('#map').select('svg');

    const radiusScale = d3
        .scaleSqrt()
        .domain([0, d3.max(stations, d => d.totalTraffic)])
        .range([0, 25]);

    // Append circles for each station
    const circles = svg
        .selectAll('circle')
        .data(stations)
        .enter()
        .append('circle')
        .attr('r', d => radiusScale(d.totalTraffic))
        .attr('fill', 'steelblue')
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('fill-opacity', 0.6)
        .each(function (d) {
            d3.select(this)
            .append('title')
            .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
        });



    // Function to update circle positions
    function updatePositions() {
      circles
        .attr('cx', (d) => getCoords(d).cx)
        .attr('cy', (d) => getCoords(d).cy);
    }

    const badStations = jsonData.data.stations.filter(
        (d) => !d.lat || !d.lon || isNaN(+d.lat) || isNaN(+d.lon)
      );
      console.log('❌ Bad stations:', badStations.length);
      
      
    // Initial update
    updatePositions();

    // Keep positions updated on interactions
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);
  } catch (error) {
    console.error('Error loading station JSON:', error);
  }
});










