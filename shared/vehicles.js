// Vehicle catalogue. Lengths/widths in world units (1 tile = 16). Speeds in units/s.
export const VEHICLES = [
  { key: 'compact', name: 'Pebble', len: 34, wid: 18, ht: 11, mass: 0.9, accel: 190, maxSpeed: 330, reverse: 110, brake: 330, grip: 8, turn: 3.0, drag: 0.0006, health: 650, seats: 2, price: 9000, engine: 0.9 },
  { key: 'sedan', name: 'Sedanza', len: 40, wid: 20, ht: 12, mass: 1.15, accel: 205, maxSpeed: 360, reverse: 110, brake: 340, grip: 8, turn: 2.8, drag: 0.0005, health: 800, seats: 4, price: 14000, engine: 0.8 },
  { key: 'sports', name: 'Zoomer GT', len: 40, wid: 20, ht: 10, mass: 1.05, accel: 300, maxSpeed: 480, reverse: 120, brake: 420, grip: 9, turn: 3.1, drag: 0.00042, health: 700, seats: 2, price: 52000, engine: 1.25 },
  { key: 'muscle', name: 'Brawler', len: 42, wid: 21, ht: 11, mass: 1.25, accel: 280, maxSpeed: 440, reverse: 120, brake: 360, grip: 6.6, turn: 2.9, drag: 0.00045, health: 850, seats: 2, price: 34000, engine: 0.6 },
  { key: 'van', name: 'Hauler', len: 46, wid: 22, ht: 16, mass: 1.7, accel: 160, maxSpeed: 300, reverse: 100, brake: 300, grip: 7.2, turn: 2.3, drag: 0.0007, health: 1000, seats: 2, price: 12000, engine: 0.7 },
  { key: 'pickup', name: 'Ranchero', len: 46, wid: 22, ht: 13, mass: 1.5, accel: 195, maxSpeed: 340, reverse: 110, brake: 320, grip: 7.5, turn: 2.5, drag: 0.0006, health: 950, seats: 2, price: 16000, engine: 0.65, offroad: 0.6 },
  { key: 'taxi', name: 'Sunny Cab', len: 40, wid: 20, ht: 13, mass: 1.15, accel: 210, maxSpeed: 365, reverse: 110, brake: 340, grip: 8, turn: 2.8, drag: 0.0005, health: 800, seats: 4, price: 0, engine: 0.85 },
  { key: 'police', name: 'Cruiser', len: 42, wid: 20, ht: 13, mass: 1.25, accel: 275, maxSpeed: 450, reverse: 120, brake: 400, grip: 8.6, turn: 3.0, drag: 0.00045, health: 1100, seats: 2, price: 0, engine: 0.75, siren: true },
  { key: 'scooter', name: 'Vespetta', len: 24, wid: 10, ht: 12, mass: 0.35, accel: 190, maxSpeed: 290, reverse: 60, brake: 330, grip: 9.5, turn: 3.6, drag: 0.0008, health: 300, seats: 1, price: 3000, engine: 1.6, bike: true },
  { key: 'icecream', name: 'Mr. Scoops', len: 48, wid: 22, ht: 18, mass: 1.6, accel: 145, maxSpeed: 270, reverse: 90, brake: 280, grip: 7, turn: 2.2, drag: 0.0008, health: 900, seats: 2, price: 0, engine: 0.7, jingle: true },
  { key: 'bus', name: 'City Bus', len: 82, wid: 25, ht: 22, mass: 4, accel: 115, maxSpeed: 250, reverse: 70, brake: 250, grip: 7, turn: 1.6, drag: 0.0009, health: 2200, seats: 2, price: 0, engine: 0.5 },
  { key: 'offroad', name: 'Trailblazer', len: 40, wid: 22, ht: 14, mass: 1.4, accel: 230, maxSpeed: 380, reverse: 120, brake: 330, grip: 8.2, turn: 2.8, drag: 0.0006, health: 1000, seats: 4, price: 26000, engine: 0.7, offroad: 0.9 },
  { key: 'ambulance', name: 'Medic Van', len: 50, wid: 22, ht: 17, mass: 1.8, accel: 195, maxSpeed: 360, reverse: 100, brake: 320, grip: 7.6, turn: 2.4, drag: 0.0006, health: 1200, seats: 2, price: 0, engine: 0.7, siren: true },
];

export const VEH_ID = Object.fromEntries(VEHICLES.map((v, i) => [v.key, i]));
VEHICLES.forEach((v, i) => (v.id = i));

export const PAINTS = [
  '#e8e4dc', '#26262c', '#c23b3b', '#e07a2f', '#f2c14e', '#6fbf5a', '#3f8f6b', '#4aa3c7',
  '#3a5fb0', '#7656b8', '#d873a8', '#9b6a45', '#8a9097', '#b8c4cc', '#5d1f2e', '#1f3d4a',
  '#f2e2b0', '#a8d8c8', '#f4a7a0', '#c7d36f',
];

// Civilian traffic mix by district key.
export const TRAFFIC_MIX = {
  default: [['sedan', 30], ['compact', 25], ['van', 8], ['pickup', 8], ['taxi', 8], ['sports', 4], ['muscle', 4], ['offroad', 5], ['scooter', 4], ['bus', 2], ['icecream', 1]],
  suburb: [['sedan', 30], ['compact', 25], ['pickup', 12], ['offroad', 12], ['van', 6], ['scooter', 6], ['sports', 4], ['icecream', 3]],
  downtown: [['sedan', 28], ['taxi', 20], ['compact', 20], ['sports', 8], ['van', 8], ['bus', 6], ['muscle', 4], ['scooter', 6]],
  docks: [['van', 30], ['pickup', 30], ['sedan', 15], ['compact', 10], ['offroad', 10]],
  estates: [['sports', 25], ['sedan', 25], ['offroad', 20], ['muscle', 15], ['compact', 15]],
};
