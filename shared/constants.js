export const TILE = 16;
export const FLOOR_H = 16;
export const MAP_W = 512;
export const MAP_H = 512;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

export const TICK_RATE = 20;
export const SNAPSHOT_RATE = 20;
export const CLIENT_SEND_RATE = 20;
export const INTERP_DELAY = 0.11;
export const VIEW_RADIUS = 1150;
export const DAY_LENGTH = 24 * 60;
export const PROTOCOL_VERSION = 3;

// Terrain ids. Order matters for blending priority of natural terrains (higher wins).
export const T = {
  DEEP: 0,
  WATER: 1,
  SAND: 2,
  GRASS: 3,
  DIRT: 4,
  FOREST: 5,
  ASPHALT: 6,
  SIDEWALK: 7,
  PLAZA: 8,
  COBBLE: 9,
  WOOD: 10,
  CONCRETE: 11,
  PARKING: 12,
  GRAVEL: 13,
  FLOWERBED: 14,
  POOL: 15,
  BRIDGE: 16,
  FLOOR: 17,
  ROCK: 18,
  TILES: 19,
  COURT: 20,
  FIELD: 21,
};
export const TERRAIN_COUNT = 22;

// natural: organic jittered borders. walk/drive: speed multipliers. surf: footstep surface.
export const TERRAIN = [];
const def = (id, name, o) => (TERRAIN[id] = { id, name, natural: false, walk: 1, drive: 1, grip: 1, surf: 'hard', map: '#888', ...o });
def(T.DEEP, 'deep water', { natural: true, walk: 0, drive: 0, surf: 'water', map: '#2d6c9e' });
def(T.WATER, 'water', { natural: true, walk: 0.55, drive: 0.35, surf: 'water', map: '#4a9ac4' });
def(T.SAND, 'sand', { natural: true, walk: 0.85, drive: 0.7, grip: 0.75, surf: 'sand', map: '#e9d39a' });
def(T.GRASS, 'grass', { natural: true, drive: 0.82, grip: 0.8, surf: 'grass', map: '#6dbb58' });
def(T.DIRT, 'dirt', { natural: true, drive: 0.85, grip: 0.8, surf: 'dirt', map: '#a8835a' });
def(T.FOREST, 'forest floor', { natural: true, drive: 0.75, grip: 0.75, surf: 'grass', map: '#4f8f45' });
def(T.ASPHALT, 'asphalt', { map: '#4a4c57' });
def(T.SIDEWALK, 'sidewalk', { map: '#b9b4ab' });
def(T.PLAZA, 'plaza', { map: '#d6c6a8' });
def(T.COBBLE, 'cobblestone', { grip: 0.92, map: '#8f8578' });
def(T.WOOD, 'boardwalk', { surf: 'wood', map: '#b58457' });
def(T.CONCRETE, 'concrete', { map: '#a3a29c' });
def(T.PARKING, 'parking', { map: '#5a5c66' });
def(T.GRAVEL, 'gravel path', { surf: 'gravel', drive: 0.9, grip: 0.85, map: '#cdbb94' });
def(T.FLOWERBED, 'flowerbed', { surf: 'grass', drive: 0.8, map: '#7aa04e' });
def(T.POOL, 'pool', { walk: 0.5, drive: 0, surf: 'water', map: '#6ad3e0' });
def(T.BRIDGE, 'bridge', { map: '#5d5a63' });
def(T.FLOOR, 'floor', { map: '#777' });
def(T.ROCK, 'rock', { natural: true, walk: 0, drive: 0, map: '#7d7d86' });
def(T.TILES, 'tiles', { map: '#c9a98a' });
def(T.COURT, 'court', { map: '#b95f4a' });
def(T.FIELD, 'field', { surf: 'grass', drive: 0.85, map: '#5fae4f' });

// Collision flags per tile.
export const F = {
  WALK: 1,
  DRIVE: 2,
  SHOT: 4,
  WATER: 8,
  BUILDING: 16,
  SHALLOW: 32,
};

export const DISTRICTS = [
  { id: 0, key: 'wild', name: 'Pinewood Hills' },
  { id: 1, key: 'willow', name: 'Willow Grove' },
  { id: 2, key: 'oldtown', name: 'Old Harbor' },
  { id: 3, key: 'maple', name: 'Maple Heights' },
  { id: 4, key: 'park', name: 'Lumen Park' },
  { id: 5, key: 'downtown', name: 'Brightwater' },
  { id: 6, key: 'market', name: 'Market Row' },
  { id: 7, key: 'docks', name: 'Saltworks Docks' },
  { id: 8, key: 'beach', name: 'Sunset Strip' },
  { id: 9, key: 'estates', name: 'Cedar Estates' },
  { id: 10, key: 'river', name: 'Lumen River' },
  { id: 11, key: 'point', name: 'Lighthouse Point' },
];
export const D = Object.fromEntries(DISTRICTS.map((d) => [d.key, d.id]));

export const BSTYLE = {
  HOUSE: 0,
  APARTMENT: 1,
  OFFICE: 2,
  TOWER: 3,
  GLASS: 4,
  BRICK: 5,
  SHOP: 6,
  WAREHOUSE: 7,
  CABIN: 8,
  CIVIC: 9,
  CLINIC: 10,
  POLICE: 11,
  GARAGE: 12,
  LIGHTHOUSE: 13,
  CONTAINER: 14,
  SHIP: 15,
  KIOSK: 16,
  CANOPY: 17,
  PARKADE: 18,
  BEACHHUT: 19,
};
export const BSTYLE_COUNT = 20;

export const ROOF = { FLAT: 0, GABLE_X: 1, GABLE_Y: 2, SAWTOOTH: 3, DOME: 4, HIP: 5 };

export const POI = {
  CLINIC: 'clinic',
  POLICE: 'police',
  GUNSHOP: 'gunshop',
  CLOTHES: 'clothes',
  RESPRAY: 'respray',
  PIZZA: 'pizza',
  TAXI: 'taxi',
  GAS: 'gas',
  CITYHALL: 'cityhall',
  CAFE: 'cafe',
  DEALER: 'dealer',
  ARCADE: 'arcade',
  DINER: 'diner',
  HOTEL: 'hotel',
  LIGHTHOUSE: 'lighthouse',
  FERRIS: 'ferris',
};

export const SHOP_POIS = new Set([POI.GUNSHOP, POI.CLOTHES, POI.RESPRAY, POI.PIZZA, POI.TAXI, POI.CLINIC, POI.DEALER, POI.DINER, POI.CAFE]);

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrapAngle = (a) => {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
export const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
