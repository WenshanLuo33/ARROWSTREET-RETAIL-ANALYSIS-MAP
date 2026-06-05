// =========================
// Map setup
// =========================

const map = L.map("map").setView([42.5190, -71.0325], 16);

const cartoLight = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    maxZoom: 20
  }
);

const esriSatellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: "Tiles &copy; Esri",
    maxZoom: 20
  }
);

cartoLight.addTo(map);

L.control.layers(
  {
    "Light Map": cartoLight,
    "Satellite": esriSatellite
  },
  null,
  {
    collapsed: false
  }
).addTo(map);

let drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

let manualParkingItems = new L.FeatureGroup();
map.addLayer(manualParkingItems);

let measurementItems = new L.FeatureGroup();
map.addLayer(measurementItems);

let selectedPolygon = null;
let manualParkingMode = false;
let areaMeasureMode = false;

let buildingLayer = null;
let poiLayer = null;
let parkingLayer = null;

// =========================
// Add measurement buttons by JS
// =========================

function addMeasurementButtons() {
  const manualParkingBtn = document.getElementById("manualParkingBtn");
  const clearManualParkingBtn = document.getElementById("clearManualParkingBtn");

  if (!manualParkingBtn || !clearManualParkingBtn) return;
  if (document.getElementById("measureAreaBtn")) return;

  const measureAreaBtn = document.createElement("button");
  measureAreaBtn.id = "measureAreaBtn";
  measureAreaBtn.textContent = "Measure Area Mode";

  const clearMeasurementsBtn = document.createElement("button");
  clearMeasurementsBtn.id = "clearMeasurementsBtn";
  clearMeasurementsBtn.textContent = "Clear Measurements";

  clearManualParkingBtn.insertAdjacentElement("afterend", measureAreaBtn);
  measureAreaBtn.insertAdjacentElement("afterend", clearMeasurementsBtn);
}

addMeasurementButtons();

// =========================
// Leaflet Draw
// =========================

const drawControl = new L.Control.Draw({
  draw: {
    polygon: {
      shapeOptions: {
        color: "#4a4a4a",
        weight: 2,
        dashArray: "6,6",
        fillOpacity: 0
      }
    },
    rectangle: {
      shapeOptions: {
        color: "#4a4a4a",
        weight: 2,
        dashArray: "6,6",
        fillOpacity: 0
      }
    },
    polyline: {
      shapeOptions: {
        color: "#111111",
        weight: 2,
        dashArray: "4,4"
      }
    },
    circle: false,
    marker: false,
    circlemarker: false
  },
  edit: {
    featureGroup: drawnItems,
    edit: true,
    remove: true
  }
});

map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, function (event) {
  const layer = event.layer;

  // Measure distance
  if (event.layerType === "polyline") {
    const geojson = layer.toGeoJSON();

    const lengthMiles = turf.length(geojson, { units: "miles" });
    const lengthFeet = lengthMiles * 5280;

    layer.setStyle({
      color: "#111111",
      weight: 2,
      dashArray: "4,4"
    });

    layer.bindPopup(`
      <b>Measured Distance</b><br>
      ${lengthFeet.toFixed(0)} ft<br>
      ${lengthMiles.toFixed(2)} miles
    `);

    measurementItems.addLayer(layer);
    layer.openPopup();

    return;
  }

  // Manual parking polygon
  if (manualParkingMode) {
    layer.setStyle({
      color: "#777777",
      weight: 1,
      fillColor: "#bfbfbf",
      fillOpacity: 0.45
    });

    manualParkingItems.addLayer(layer);

    const parkingFeature = layer.toGeoJSON();
    const metrics = estimateManualParkingMetrics(parkingFeature);

    layer.bindPopup(`
      <b>Manual Parking Lot</b><br>
      <b>Area:</b> ${metrics.areaSqFt.toLocaleString()} sf<br>
      <b>Estimated Spaces:</b> ${metrics.estimatedCapacity.toLocaleString()}<br>
      <b>Source:</b> Manually drawn / area ÷ 330 sf
    `);

    document.getElementById("summary").innerHTML =
      "<p>Manual parking polygon added. Click <b>Run Analysis</b> again to update totals.</p>";

    return;
  }

  // Measure area polygon
  if (areaMeasureMode) {
    layer.setStyle({
      color: "#111111",
      weight: 2,
      dashArray: "4,4",
      fillColor: "#ffffff",
      fillOpacity: 0.05
    });

    const areaFeature = layer.toGeoJSON();
    const areaSqM = turf.area(areaFeature);
    const areaSqFt = areaSqM * 10.7639;
    const areaAcres = areaSqFt / 43560;

    layer.bindPopup(`
      <b>Measured Area</b><br>
      ${Math.round(areaSqFt).toLocaleString()} sf<br>
      ${areaAcres.toFixed(2)} acres
    `);

    measurementItems.addLayer(layer);
    layer.openPopup();

    document.getElementById("summary").innerHTML =
      "<p>Measured area added. Use <b>Clear Measurements</b> to remove it.</p>";

    return;
  }

  // Main analysis polygon
  drawnItems.clearLayers();

  layer.setStyle({
    color: "#4a4a4a",
    weight: 2,
    dashArray: "6,6",
    fillOpacity: 0
  });

  drawnItems.addLayer(layer);
  selectedPolygon = layer.toGeoJSON();

  document.getElementById("summary").innerHTML =
    "<p>Analysis polygon selected. Click <b>Run Analysis</b>.</p>";
});

map.on(L.Draw.Event.DELETED, function () {
  if (drawnItems.getLayers().length === 0) {
    selectedPolygon = null;
  }
});

map.on(L.Draw.Event.EDITED, function () {
  drawnItems.eachLayer(layer => {
    layer.setStyle({
      color: "#4a4a4a",
      weight: 2,
      dashArray: "6,6",
      fillOpacity: 0
    });

    selectedPolygon = layer.toGeoJSON();
  });

  manualParkingItems.eachLayer(layer => {
    layer.setStyle({
      color: "#777777",
      weight: 1,
      fillColor: "#bfbfbf",
      fillOpacity: 0.45
    });
  });
});

// =========================
// Search place
// =========================

async function searchPlace() {
  const query = document.getElementById("searchInput").value.trim();

  if (!query) {
    alert("Please enter a place or address.");
    return;
  }

  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(query);

  const response = await fetch(url, {
    headers: {
      "Accept": "application/json"
    }
  });

  const results = await response.json();

  if (!results || results.length === 0) {
    alert("No place found.");
    return;
  }

  const result = results[0];
  const lat = parseFloat(result.lat);
  const lon = parseFloat(result.lon);

  map.setView([lat, lon], 16);

  document.getElementById("summary").innerHTML =
    `<p>Found: <b>${result.display_name}</b><br>Now draw the main analysis boundary.</p>`;
}

// =========================
// Geo helpers
// =========================

function polygonToBbox(polygon) {
  const bbox = turf.bbox(polygon);

  return {
    west: bbox[0],
    south: bbox[1],
    east: bbox[2],
    north: bbox[3]
  };
}

function isFeatureInsidePolygon(feature, polygon) {
  try {
    if (feature.geometry.type === "Point") {
      return turf.booleanPointInPolygon(feature, polygon);
    }

    const centroid = turf.centroid(feature);
    return turf.booleanPointInPolygon(centroid, polygon);
  } catch (e) {
    return false;
  }
}

// =========================
// Overpass query
// =========================

async function fetchOSMData(bbox) {
  const { south, west, north, east } = bbox;

  const query = `
    [out:json][timeout:90];
    (
      way["building"](${south},${west},${north},${east});

      node["shop"](${south},${west},${north},${east});
      node["amenity"](${south},${west},${north},${east});
      node["tourism"](${south},${west},${north},${east});
      node["leisure"](${south},${west},${north},${east});
      node["office"](${south},${west},${north},${east});
      node["healthcare"](${south},${west},${north},${east});

      way["shop"](${south},${west},${north},${east});
      way["amenity"](${south},${west},${north},${east});
      way["tourism"](${south},${west},${north},${east});
      way["leisure"](${south},${west},${north},${east});
      way["office"](${south},${west},${north},${east});
      way["healthcare"](${south},${west},${north},${east});

      way["amenity"="parking"](${south},${west},${north},${east});
      relation["amenity"="parking"](${south},${west},${north},${east});
    );
    out body geom;
  `;

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: "data=" + encodeURIComponent(query)
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(text);
    throw new Error("Overpass API request failed.");
  }

  const osmJson = await response.json();
  return overpassToGeoJSON(osmJson);
}

function overpassToGeoJSON(osmJson) {
  const features = [];

  osmJson.elements.forEach(el => {
    const tags = el.tags || {};

    if (el.type === "node" && el.lat !== undefined && el.lon !== undefined) {
      features.push({
        type: "Feature",
        properties: {
          ...tags,
          osm_id: el.id,
          osm_type: "node"
        },
        geometry: {
          type: "Point",
          coordinates: [el.lon, el.lat]
        }
      });
    }

    if (el.type === "way" && el.geometry && el.geometry.length > 2) {
      const coords = el.geometry.map(p => [p.lon, p.lat]);

      const first = coords[0];
      const last = coords[coords.length - 1];

      const isClosed =
        first[0] === last[0] &&
        first[1] === last[1];

      if (!isClosed) {
        coords.push(first);
      }

      features.push({
        type: "Feature",
        properties: {
          ...tags,
          osm_id: el.id,
          osm_type: "way"
        },
        geometry: {
          type: "Polygon",
          coordinates: [coords]
        }
      });
    }

    if (el.type === "relation" && el.members) {
      const outerWays = el.members.filter(m =>
        m.role === "outer" &&
        m.geometry &&
        m.geometry.length > 2
      );

      outerWays.forEach(m => {
        const coords = m.geometry.map(p => [p.lon, p.lat]);

        const first = coords[0];
        const last = coords[coords.length - 1];

        const isClosed =
          first[0] === last[0] &&
          first[1] === last[1];

        if (!isClosed) {
          coords.push(first);
        }

        features.push({
          type: "Feature",
          properties: {
            ...tags,
            osm_id: el.id,
            osm_type: "relation"
          },
          geometry: {
            type: "Polygon",
            coordinates: [coords]
          }
        });
      });
    }
  });

  return {
    type: "FeatureCollection",
    features: features
  };
}

// =========================
// Classification
// =========================

function classifyPOI(props) {
  const shop = (props.shop || "").toLowerCase();
  const amenity = (props.amenity || "").toLowerCase();
  const tourism = (props.tourism || "").toLowerCase();
  const leisure = (props.leisure || "").toLowerCase();
  const office = (props.office || "").toLowerCase();
  const healthcare = (props.healthcare || "").toLowerCase();

  const restaurantTypes = [
    "restaurant", "cafe", "fast_food", "bar", "pub",
    "ice_cream", "food_court"
  ];

  const groceryTypes = [
    "supermarket", "grocery", "convenience", "greengrocer",
    "bakery", "deli", "butcher", "seafood"
  ];

  const fashionTypes = [
    "clothes", "shoes", "jewelry", "bag", "boutique",
    "fashion", "sports"
  ];

  const homeTypes = [
    "furniture", "interior_decoration", "houseware",
    "doityourself", "hardware", "kitchen"
  ];

  const beautyTypes = [
    "beauty", "hairdresser", "cosmetics", "spa",
    "massage", "nails"
  ];

  const serviceTypes = [
    "bank", "atm", "post_office", "clinic", "dentist",
    "doctors", "pharmacy", "dry_cleaning", "laundry"
  ];

  if (restaurantTypes.includes(amenity)) return "Food & Beverage";
  if (groceryTypes.includes(shop)) return "Grocery / Food Retail";
  if (fashionTypes.includes(shop)) return "Fashion / Apparel";
  if (homeTypes.includes(shop)) return "Home / Furniture";
  if (beautyTypes.includes(shop)) return "Beauty / Personal Care";
  if (serviceTypes.includes(shop) || serviceTypes.includes(amenity) || healthcare) return "Service / Health";
  if (tourism === "hotel") return "Hotel";
  if (["fitness_centre", "sports_centre", "gym"].includes(leisure)) return "Fitness / Leisure";
  if (office) return "Office";
  if (shop) return "Other Retail";
  if (amenity) return "Other Amenity";

  return "Unknown";
}

function classifyBuilding(props) {
  const building = (props.building || "").toLowerCase();
  const name = (props.name || "").toLowerCase();

  const residentialTypes = [
    "apartments",
    "house",
    "terrace",
    "detached",
    "residential",
    "semidetached_house"
  ];

  const retailTypes = [
    "retail",
    "commercial",
    "supermarket"
  ];

  if (residentialTypes.includes(building)) return "Residential";
  if (retailTypes.includes(building)) return "Retail / Commercial";
  if (building === "hotel") return "Hotel";
  if (building === "office") return "Office";
  if (building === "parking" || building === "garage") return "Parking";
  if (name.includes("apartment") || name.includes("residence")) return "Residential";

  return "Unknown";
}

function isRetailLike(category) {
  return [
    "Food & Beverage",
    "Grocery / Food Retail",
    "Fashion / Apparel",
    "Home / Furniture",
    "Beauty / Personal Care",
    "Service / Health",
    "Fitness / Leisure",
    "Other Retail",
    "Other Amenity"
  ].includes(category);
}

// =========================
// Geometry analysis
// =========================

function estimateBuildingMetrics(feature) {
  const areaSqM = turf.area(feature);
  const areaSqFt = areaSqM * 10.7639;

  const bbox = turf.bbox(feature);
  const west = bbox[0];
  const south = bbox[1];
  const east = bbox[2];
  const north = bbox[3];

  const widthM = turf.distance([west, south], [east, south], { units: "meters" });
  const heightM = turf.distance([west, south], [west, north], { units: "meters" });

  const depthFt = Math.min(widthM, heightM) * 3.28084;
  const lengthFt = Math.max(widthM, heightM) * 3.28084;

  return {
    areaSqFt,
    depthFt,
    lengthFt
  };
}

function estimateParkingMetrics(feature) {
  const areaSqM = turf.area(feature);
  const areaSqFt = areaSqM * 10.7639;

  const rawCapacity = feature.properties.capacity || null;
  const osmCapacity = rawCapacity ? parseInt(rawCapacity, 10) : null;

  const estimatedCapacity = Math.round(areaSqFt / 330);

  return {
    areaSqFt: Math.round(areaSqFt),
    osmCapacity: Number.isFinite(osmCapacity) ? osmCapacity : null,
    estimatedCapacity: Number.isFinite(osmCapacity) ? osmCapacity : estimatedCapacity,
    capacitySource: Number.isFinite(osmCapacity)
      ? "OSM capacity tag"
      : "Estimated by area / 330 sf per space"
  };
}

function estimateManualParkingMetrics(feature) {
  const areaSqM = turf.area(feature);
  const areaSqFt = areaSqM * 10.7639;
  const estimatedCapacity = Math.round(areaSqFt / 330);

  return {
    areaSqFt: Math.round(areaSqFt),
    estimatedCapacity: estimatedCapacity
  };
}

function getFeaturePoint(feature) {
  if (feature.geometry.type === "Point") {
    return feature;
  }

  return turf.centroid(feature);
}

// =========================
// Styling
// =========================

function buildingColor(use) {
  if (use === "Retail / Commercial") return "#e45756";
  if (use === "Residential") return "#4c78a8";
  if (use === "Hotel") return "#f2cf5b";
  if (use === "Office") return "#b279a2";
  if (use === "Parking") return "#cfcfcf";
  return "#8f8f8f";
}

function poiColor(category) {
  if (category === "Food & Beverage") return "red";
  if (category === "Grocery / Food Retail") return "green";
  if (category === "Fashion / Apparel") return "purple";
  if (category === "Home / Furniture") return "orange";
  if (category === "Beauty / Personal Care") return "pink";
  if (category === "Service / Health") return "blue";
  if (category === "Fitness / Leisure") return "cadetblue";
  if (category === "Hotel") return "beige";
  if (category === "Office") return "darkpurple";
  if (category === "Other Retail") return "gray";
  return "black";
}

// =========================
// Manual parking helpers
// =========================

function getManualParkingFeatures() {
  const features = [];

  manualParkingItems.eachLayer(layer => {
    const feature = layer.toGeoJSON();
    const metrics = estimateManualParkingMetrics(feature);

    feature.properties = {
      ...feature.properties,
      parking_id: `M-${features.length + 1}`,
      parking_area_sf: metrics.areaSqFt,
      osm_capacity: null,
      estimated_capacity: metrics.estimatedCapacity,
      capacity_source: "Manually drawn / area ÷ 330 sf"
    };

    features.push(feature);
  });

  return features;
}

function setManualParkingMode(active) {
  manualParkingMode = active;

  if (active) {
    areaMeasureMode = false;
    updateAreaMeasureButton(false);
  }

  const btn = document.getElementById("manualParkingBtn");

  if (manualParkingMode) {
    btn.textContent = "Manual Parking Mode: ON";
    btn.classList.add("active-mode");

    document.getElementById("summary").innerHTML =
      "<p>Manual Parking Mode is ON. Draw parking polygons on the map.</p>";
  } else {
    btn.textContent = "Add Manual Parking Polygon";
    btn.classList.remove("active-mode");

    document.getElementById("summary").innerHTML =
      "<p>Manual Parking Mode is OFF. Draw or edit the analysis polygon, then run analysis.</p>";
  }
}

// =========================
// Measurement helpers
// =========================

function updateAreaMeasureButton(active) {
  const btn = document.getElementById("measureAreaBtn");
  if (!btn) return;

  if (active) {
    btn.textContent = "Measure Area Mode: ON";
    btn.classList.add("active-mode");
  } else {
    btn.textContent = "Measure Area Mode";
    btn.classList.remove("active-mode");
  }
}

function setAreaMeasureMode(active) {
  areaMeasureMode = active;

  if (active) {
    manualParkingMode = false;
    const parkingBtn = document.getElementById("manualParkingBtn");
    if (parkingBtn) {
      parkingBtn.textContent = "Add Manual Parking Polygon";
      parkingBtn.classList.remove("active-mode");
    }

    document.getElementById("summary").innerHTML =
      "<p>Measure Area Mode is ON. Draw a polygon or rectangle to measure its area.</p>";
  } else {
    document.getElementById("summary").innerHTML =
      "<p>Measure Area Mode is OFF. Draw the analysis polygon or run analysis.</p>";
  }

  updateAreaMeasureButton(active);
}

function clearMeasurements() {
  measurementItems.clearLayers();
  areaMeasureMode = false;
  updateAreaMeasureButton(false);

  document.getElementById("summary").innerHTML =
    "<p>Measurements cleared.</p>";
}

// =========================
// Main analysis
// =========================

async function runAnalysis() {
  if (!selectedPolygon) {
    alert("Please draw the main analysis boundary first.");
    return;
  }

  setManualParkingMode(false);
  setAreaMeasureMode(false);

  document.getElementById("summary").innerHTML = "<p>Loading OSM data...</p>";

  if (buildingLayer) map.removeLayer(buildingLayer);
  if (poiLayer) map.removeLayer(poiLayer);
  if (parkingLayer) map.removeLayer(parkingLayer);

  const bbox = polygonToBbox(selectedPolygon);

  try {
    const rawGeojson = await fetchOSMData(bbox);

    let features = rawGeojson.features.filter(f =>
      isFeatureInsidePolygon(f, selectedPolygon)
    );

    const buildings = features.filter(f =>
      f.properties &&
      f.properties.building &&
      (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
    );

    const osmParkingLots = features.filter(f =>
      f.properties &&
      f.properties.amenity === "parking" &&
      (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
    );

    const manualParkingLots = getManualParkingFeatures();
    const parkingLots = [...osmParkingLots, ...manualParkingLots];

    let pois = features.filter(f =>
      f.properties &&
      f.properties.amenity !== "parking" &&
      (
        f.properties.shop ||
        f.properties.amenity ||
        f.properties.tourism ||
        f.properties.leisure ||
        f.properties.office ||
        f.properties.healthcare
      )
    );

    pois = pois.filter(f =>
      f.properties.name &&
      f.properties.name.trim() !== ""
    );

    pois.forEach(p => {
      p.properties.tenant_category = classifyPOI(p.properties);
      p.properties.tenant_name = p.properties.name || "";
      p.properties.point = getFeaturePoint(p);
    });

    buildings.forEach((b, i) => {
      b.properties.building_id = i;
      b.properties.building_use = classifyBuilding(b.properties);

      const metrics = estimateBuildingMetrics(b);
      b.properties.depth_est_ft = Math.round(metrics.depthFt);
      b.properties.length_est_ft = Math.round(metrics.lengthFt);
      b.properties.building_area_sf = Math.round(metrics.areaSqFt);
    });

    osmParkingLots.forEach((p, i) => {
      const metrics = estimateParkingMetrics(p);

      p.properties.parking_id = `O-${i + 1}`;
      p.properties.parking_area_sf = metrics.areaSqFt;
      p.properties.osm_capacity = metrics.osmCapacity;
      p.properties.estimated_capacity = metrics.estimatedCapacity;
      p.properties.capacity_source = metrics.capacitySource;
    });

    pois.forEach(poi => {
      const point = poi.properties.point;
      const category = poi.properties.tenant_category;

      buildings.forEach(b => {
        if (turf.booleanPointInPolygon(point, b)) {
          if (isRetailLike(category)) {
            b.properties.building_use = "Retail / Commercial";
          }
          if (category === "Hotel") {
            b.properties.building_use = "Hotel";
          }
          if (category === "Office") {
            b.properties.building_use = "Office";
          }
        }
      });
    });

    parkingLayer = L.geoJSON(parkingLots, {
      style: feature => {
        const isManual =
          feature.properties.capacity_source === "Manually drawn / area ÷ 330 sf";

        return {
          fillColor: isManual ? "#bfbfbf" : "#d9d9d9",
          color: isManual ? "#555555" : "#777777",
          weight: 1,
          fillOpacity: 0.45
        };
      },
      onEachFeature: (feature, layer) => {
        const area = feature.properties.parking_area_sf ?? null;
        const spaces = feature.properties.estimated_capacity ?? "N/A";
        const source = feature.properties.capacity_source ?? "N/A";

        layer.bindPopup(`
          <b>Parking Lot ID:</b> ${feature.properties.parking_id}<br>
          <b>Area:</b> ${area === null ? "N/A" : area.toLocaleString()} sf<br>
          <b>Parking Spaces:</b> ${spaces === "N/A" ? "N/A" : spaces.toLocaleString()}<br>
          <b>Source:</b> ${source}
        `);
      }
    }).addTo(map);

    buildingLayer = L.geoJSON(buildings, {
      style: feature => ({
        fillColor: buildingColor(feature.properties.building_use),
        color: "#333",
        weight: 0.8,
        fillOpacity: 0.5
      }),
      onEachFeature: (feature, layer) => {
        const length = feature.properties.length_est_ft ?? null;
        const depth = feature.properties.depth_est_ft ?? null;
        const area = feature.properties.building_area_sf ?? null;

        layer.bindPopup(`
          <b>Building ID:</b> ${feature.properties.building_id}<br>
          <b>Use:</b> ${feature.properties.building_use}<br>
          <b>Length:</b> ${length === null ? "N/A" : length.toLocaleString()} ft<br>
          <b>Depth / Width:</b> ${depth === null ? "N/A" : depth.toLocaleString()} ft<br>
          <b>Area:</b> ${area === null ? "N/A" : area.toLocaleString()} sf
        `);
      }
    }).addTo(map);

    poiLayer = L.layerGroup().addTo(map);

    pois.forEach(p => {
      const point = p.properties.point.geometry.coordinates;
      const category = p.properties.tenant_category;

      L.circleMarker([point[1], point[0]], {
        radius: 3,
        color: poiColor(category),
        fillColor: poiColor(category),
        fillOpacity: 0.85,
        weight: 1
      })
        .bindPopup(`
          <b>${p.properties.tenant_name}</b><br>
          Category: ${category}<br>
          Shop: ${p.properties.shop || ""}<br>
          Amenity: ${p.properties.amenity || ""}
        `)
        .addTo(poiLayer);
    });

    const buildingUseCounts = {};
    buildings.forEach(b => {
      const use = b.properties.building_use;
      buildingUseCounts[use] = (buildingUseCounts[use] || 0) + 1;
    });

    const tenantCounts = {};
    pois.forEach(p => {
      const cat = p.properties.tenant_category;
      tenantCounts[cat] = (tenantCounts[cat] || 0) + 1;
    });

    const totalParkingSpaces = parkingLots.reduce((sum, p) => {
      return sum + (p.properties.estimated_capacity || 0);
    }, 0);

    const totalParkingArea = parkingLots.reduce((sum, p) => {
      return sum + (p.properties.parking_area_sf || 0);
    }, 0);

    const osmParkingArea = osmParkingLots.reduce((sum, p) => {
      return sum + (p.properties.parking_area_sf || 0);
    }, 0);

    const manualParkingArea = manualParkingLots.reduce((sum, p) => {
      return sum + (p.properties.parking_area_sf || 0);
    }, 0);

    const siteAreaSqFt = turf.area(selectedPolygon) * 10.7639;
    const siteAreaAcres = siteAreaSqFt / 43560;

    const totalRetailBuildingArea = buildings.reduce((sum, b) => {
      if (b.properties.building_use === "Retail / Commercial") {
        return sum + (b.properties.building_area_sf || 0);
      }
      return sum;
    }, 0);

    const totalBuildingArea = buildings.reduce((sum, b) => {
      return sum + (b.properties.building_area_sf || 0);
    }, 0);

    const parkingRatio = totalRetailBuildingArea > 0
      ? totalParkingSpaces / (totalRetailBuildingArea / 1000)
      : 0;

    const sfPerParkingSpace = totalParkingSpaces > 0
      ? totalRetailBuildingArea / totalParkingSpaces
      : 0;

    const buildingCoverage = siteAreaSqFt > 0
      ? (totalBuildingArea / siteAreaSqFt) * 100
      : 0;

    document.getElementById("summary").innerHTML = `
      <p><b>Site Area:</b> ${siteAreaAcres.toFixed(2)} acres</p>
      <p><b>Total Retail Building Area:</b> ${Math.round(totalRetailBuildingArea).toLocaleString()} sf</p>
      <p><b>Parking Lots:</b> ${parkingLots.length}</p>
      <p><b>OSM Parking Lots:</b> ${osmParkingLots.length}</p>
      <p><b>Manual Parking Lots:</b> ${manualParkingLots.length}</p>
      <p><b>Total Parking Area:</b> ${Math.round(totalParkingArea).toLocaleString()} sf</p>
      <p><b>OSM Parking Area:</b> ${Math.round(osmParkingArea).toLocaleString()} sf</p>
      <p><b>Manual Parking Area:</b> ${Math.round(manualParkingArea).toLocaleString()} sf</p>
      <p><b>Estimated Parking Spaces:</b> ${totalParkingSpaces.toLocaleString()}</p>
      <p><b>Parking Ratio:</b> ${parkingRatio.toFixed(2)} spaces / 1,000 sf retail</p>
      <p><b>SF per Parking Space:</b> ${sfPerParkingSpace > 0 ? Math.round(sfPerParkingSpace).toLocaleString() : "N/A"} sf retail / space</p>
      <p><b>Building Coverage:</b> ${buildingCoverage.toFixed(1)}%</p>

      <hr>

      <p><b>Formula Notes</b><br>
      Site acreage = polygon area / 43,560<br>
      Retail area = sum of Retail / Commercial building footprints<br>
      Parking count = OSM capacity, or parking lot area / 330 sf; manual parking also uses area / 330 sf<br>
      Parking ratio = spaces / retail sf × 1,000<br>
      SF per parking space = retail sf / spaces<br>
      Building coverage = total building footprint area / site area</p>

      <hr>

      <p><b>Buildings:</b> ${buildings.length}</p>
      <p><b>Named Tenants:</b> ${pois.length}</p>

      <p><b>Building Use</b><br>
      ${Object.entries(buildingUseCounts).map(([k,v]) => `${k}: ${v}`).join("<br>")}</p>

      <p><b>Tenant Mix</b><br>
      ${Object.entries(tenantCounts).map(([k,v]) => `${k}: ${v}`).join("<br>")}</p>
    `;

  } catch (error) {
    console.error(error);
    document.getElementById("summary").innerHTML = `
      <p style="color:red;">Error loading data. Try again or draw a smaller polygon.</p>
    `;
  }
}

// =========================
// Clear
// =========================

function clearAll() {
  drawnItems.clearLayers();
  manualParkingItems.clearLayers();
  measurementItems.clearLayers();

  selectedPolygon = null;
  manualParkingMode = false;
  areaMeasureMode = false;

  if (buildingLayer) map.removeLayer(buildingLayer);
  if (poiLayer) map.removeLayer(poiLayer);
  if (parkingLayer) map.removeLayer(parkingLayer);

  const parkingBtn = document.getElementById("manualParkingBtn");
  if (parkingBtn) {
    parkingBtn.textContent = "Add Manual Parking Polygon";
    parkingBtn.classList.remove("active-mode");
  }

  updateAreaMeasureButton(false);

  document.getElementById("summary").innerHTML =
    "<p>Search a place, draw a custom polygon, and analyze buildings, tenants, and parking lots inside the selected area.</p>";
}

function clearManualParking() {
  manualParkingItems.clearLayers();
  manualParkingMode = false;

  const btn = document.getElementById("manualParkingBtn");
  btn.textContent = "Add Manual Parking Polygon";
  btn.classList.remove("active-mode");

  document.getElementById("summary").innerHTML =
    "<p>Manual parking polygons cleared. Click Run Analysis again to update totals.</p>";
}

// =========================
// Google Street View
// =========================

function openGoogleStreetView() {
  let lat;
  let lon;

  if (selectedPolygon) {
    const center = turf.centroid(selectedPolygon);

    lon = center.geometry.coordinates[0];
    lat = center.geometry.coordinates[1];
  } else {
    const mapCenter = map.getCenter();

    lat = mapCenter.lat;
    lon = mapCenter.lng;
  }

  const streetViewURL =
    `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;

  window.open(streetViewURL, "_blank");
}

// =========================
// Events
// =========================

document.getElementById("searchBtn").addEventListener("click", searchPlace);
document.getElementById("runBtn").addEventListener("click", runAnalysis);
document.getElementById("clearBtn").addEventListener("click", clearAll);

document.getElementById("manualParkingBtn").addEventListener("click", () => {
  setManualParkingMode(!manualParkingMode);
});

document.getElementById("clearManualParkingBtn").addEventListener("click", clearManualParking);

document.getElementById("streetViewBtn").addEventListener("click", openGoogleStreetView);

document.getElementById("measureAreaBtn").addEventListener("click", () => {
  setAreaMeasureMode(!areaMeasureMode);
});

document.getElementById("clearMeasurementsBtn").addEventListener("click", clearMeasurements);