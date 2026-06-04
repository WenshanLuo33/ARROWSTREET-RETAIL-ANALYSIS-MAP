// =========================
// Map setup
// =========================

const map = L.map("map").setView([42.5190, -71.0325], 16);

L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    maxZoom: 20
  }
).addTo(map);

let boundaryLayer = null;
let buildingLayer = null;
let poiLayer = null;

// =========================
// Helper: create 1km x 1km bbox
// =========================

function createOneKmBBox(lat, lon) {
  const halfMeters = 500;

  const deltaLat = halfMeters / 111320;
  const deltaLon = halfMeters / (111320 * Math.cos(lat * Math.PI / 180));

  const south = lat - deltaLat;
  const north = lat + deltaLat;
  const west = lon - deltaLon;
  const east = lon + deltaLon;

  return { south, west, north, east };
}

function bboxToPolygon(bbox) {
  const coords = [
    [bbox.west, bbox.south],
    [bbox.east, bbox.south],
    [bbox.east, bbox.north],
    [bbox.west, bbox.north],
    [bbox.west, bbox.south]
  ];

  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [coords]
    }
  };
}

// =========================
// Overpass query
// =========================

async function fetchOSMData(bbox) {
  const { south, west, north, east } = bbox;

  const query = `
    [out:json][timeout:60];
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
  console.log("OSM elements:", osmJson.elements.length);

  return overpassToGeoJSON(osmJson);
}


function overpassToGeoJSON(osmJson) {
  const features = [];

  osmJson.elements.forEach(el => {
    const tags = el.tags || {};

    // Node POI
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

    // Way polygon / line
    if (el.type === "way" && el.geometry && el.geometry.length > 2) {
      const coords = el.geometry.map(p => [p.lon, p.lat]);

      const first = coords[0];
      const last = coords[coords.length - 1];

      const isClosed =
        first[0] === last[0] &&
        first[1] === last[1];

      // buildings and most shop/amenity ways are polygons
      if (isClosed || tags.building || tags.shop || tags.amenity || tags.tourism || tags.leisure || tags.office || tags.healthcare) {
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

  const restaurantTypes = ["restaurant", "cafe", "fast_food", "bar", "pub", "ice_cream", "food_court"];
  const groceryTypes = ["supermarket", "grocery", "convenience", "greengrocer", "bakery", "deli", "butcher", "seafood"];
  const fashionTypes = ["clothes", "shoes", "jewelry", "bag", "boutique", "fashion", "sports"];
  const homeTypes = ["furniture", "interior_decoration", "houseware", "doityourself", "hardware", "kitchen"];
  const beautyTypes = ["beauty", "hairdresser", "cosmetics", "spa", "massage", "nails"];
  const serviceTypes = ["bank", "atm", "post_office", "clinic", "dentist", "doctors", "pharmacy", "dry_cleaning", "laundry"];

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

  const residentialTypes = ["apartments", "house", "terrace", "detached", "residential", "semidetached_house"];
  const retailTypes = ["retail", "commercial", "supermarket"];

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
  if (use === "Parking") return "#9d9d9d";
  return "#d3d3d3";
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
// Main analysis
// =========================

async function runAnalysis() {
  const lat = parseFloat(document.getElementById("latInput").value);
  const lon = parseFloat(document.getElementById("lonInput").value);

  document.getElementById("summary").innerHTML = "<p>Loading OSM data...</p>";

  if (boundaryLayer) map.removeLayer(boundaryLayer);
  if (buildingLayer) map.removeLayer(buildingLayer);
  if (poiLayer) map.removeLayer(poiLayer);

  const bbox = createOneKmBBox(lat, lon);
  const boundary = bboxToPolygon(bbox);

  map.fitBounds([
    [bbox.south, bbox.west],
    [bbox.north, bbox.east]
  ]);

  boundaryLayer = L.geoJSON(boundary, {
    style: {
      color: "#999",
      weight: 1,
      fillOpacity: 0
    }
  }).addTo(map);

  try {
    const geojson = await fetchOSMData(bbox);

    const buildings = geojson.features.filter(f =>
      f.properties &&
      f.properties.building &&
      (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
    );

    let pois = geojson.features.filter(f =>
      f.properties &&
      (
        f.properties.shop ||
        f.properties.amenity ||
        f.properties.tourism ||
        f.properties.leisure ||
        f.properties.office ||
        f.properties.healthcare
      )
    );

    // Only display named POIs
    pois = pois.filter(f => f.properties.name && f.properties.name.trim() !== "");

    // Classify POIs
    pois.forEach(p => {
      p.properties.tenant_category = classifyPOI(p.properties);
      p.properties.tenant_name = p.properties.name || "";
      p.properties.point = getFeaturePoint(p);
    });

    // Classify buildings first from OSM building tags
    buildings.forEach((b, i) => {
      b.properties.building_id = i;
      b.properties.building_use = classifyBuilding(b.properties);

      const metrics = estimateBuildingMetrics(b);
      b.properties.depth_est_ft = Math.round(metrics.depthFt);
      b.properties.length_est_ft = Math.round(metrics.lengthFt);
      b.properties.building_area_sf = Math.round(metrics.areaSqFt);
    });

    // Match POIs to buildings:
    // If POI point falls inside a building, classify that building as Retail / Commercial / Hotel / Office
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

    buildingLayer = L.geoJSON(buildings, {
      style: feature => ({
        fillColor: buildingColor(feature.properties.building_use),
        color: "#333",
        weight: 0.8,
        fillOpacity: 0.5
      }),
      onEachFeature: (feature, layer) => {
        layer.bindPopup(`
          <b>Building ID:</b> ${feature.properties.building_id}<br>
          <b>Use:</b> ${feature.properties.building_use}<br>
          <b>Depth:</b> ${feature.properties.depth_est_ft} ft<br>
          <b>Area:</b> ${feature.properties.building_area_sf} sf
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

    document.getElementById("summary").innerHTML = `
      <p><b>Buildings:</b> ${buildings.length}</p>
      <p><b>Named Tenants:</b> ${pois.length}</p>
      <p><b>Building Use</b><br>${Object.entries(buildingUseCounts).map(([k,v]) => `${k}: ${v}`).join("<br>")}</p>
      <p><b>Tenant Mix</b><br>${Object.entries(tenantCounts).map(([k,v]) => `${k}: ${v}`).join("<br>")}</p>
    `;

  } catch (error) {
    console.error(error);
    document.getElementById("summary").innerHTML = `
      <p style="color:red;">Error loading data. Try again or use a smaller area.</p>
    `;
  }
}

document.getElementById("runBtn").addEventListener("click", runAnalysis);