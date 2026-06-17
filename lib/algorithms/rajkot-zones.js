// Rajkot delivery-zone graph: a small road network of well-known Rajkot
// localities with approximate inter-zone road distances (km). Used by the
// `delivery-route` insight to compute the shortest delivery path + an ETA /
// fee estimate via Dijkstra (lib/algorithms/dijkstra.js).
//
// Edges are undirected (build the graph with directed=false). Weights are
// kilometres; only adjacent (directly connected) zones get an edge — the
// algorithm derives every other distance.

const ZONES = [
  'Kalavad Road', 'University Road', 'Race Course', 'Yagnik Road',
  '150 Feet Ring Road', 'Gondal Road', 'Mavdi', 'Kotharia',
  'Aji Dam', 'Bhaktinagar', 'Raiya Road', 'Morbi Road',
];

// [zoneA, zoneB, km]
const EDGES = [
  ['Kalavad Road', 'University Road', 3.0],
  ['University Road', 'Race Course', 2.5],
  ['Race Course', 'Yagnik Road', 2.0],
  ['Yagnik Road', 'Bhaktinagar', 3.0],
  ['Race Course', 'Raiya Road', 2.2],
  ['Raiya Road', '150 Feet Ring Road', 4.0],
  ['Kalavad Road', '150 Feet Ring Road', 5.5],
  ['150 Feet Ring Road', 'Mavdi', 3.5],
  ['Mavdi', 'Gondal Road', 2.8],
  ['Gondal Road', 'Kotharia', 4.0],
  ['Gondal Road', 'Bhaktinagar', 3.2],
  ['Bhaktinagar', 'Aji Dam', 2.6],
  ['Aji Dam', 'Morbi Road', 4.5],
  ['Morbi Road', 'Kalavad Road', 6.0],
  ['Yagnik Road', 'Raiya Road', 1.8],
];

// Build a WeightedPrecisionGraph wired with the zone network.
// `WeightedPrecisionGraph` is the Dijkstra implementation from this toolkit.
function buildZoneGraph(WeightedPrecisionGraph) {
  const g = new WeightedPrecisionGraph({}, /* directed */ false);
  for (const z of ZONES) g.addNode(z);
  for (const [a, b, km] of EDGES) g.addEdge(a, b, km);
  return g;
}

module.exports = { ZONES, EDGES, buildZoneGraph };
