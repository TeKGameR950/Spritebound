// Compact world (de)serialisation shared by server and client.

const B64 = typeof Buffer !== 'undefined';

function toB64(u8) {
  if (B64) return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(str) {
  if (B64) return new Uint8Array(Buffer.from(str, 'base64'));
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const BKEYS = ['id', 'x', 'y', 'w', 'h', 'floors', 'style', 'roof', 'rc', 'wc', 'seed', 'awn'];

export function packWorld(w) {
  return {
    v: 2,
    seed: w.seed, w: w.w, h: w.h,
    ground: toB64(w.ground),
    district: toB64(w.district),
    buildings: w.buildings.map((b) => [
      ...BKEYS.map((k) => b[k]),
      b.door ? b.door.side : -1, b.door ? b.door.t : 0, b.poi || '', b.open ? 1 : 0, b.sign || '', b.water ? 1 : 0,
    ]),
    props: w.props,
    nodes: w.nodes.map((n) => [n.id, n.tx, n.ty, n.tw, n.th, n.edges, n.signal ? 1 : 0, n.cross ? 1 : 0, n.inter ? 1 : 0, n.district]),
    edges: w.edges.map((e) => [e.id, e.a, e.b, e.dir === 'h' ? 0 : 1, e.w, e.art ? 1 : 0, e.bridge ? 1 : 0, e.lanes, e.x0, e.y0, e.x1, e.y1]),
    pois: w.pois,
    collectibles: w.collectibles,
    pickups: w.pickups,
    lighthouse: w.lighthouse,
    pier: w.pier,
    parkLake: w.parkLake,
    courts: w.courts,
    parkingLots: w.parkingLots,
    gasStations: w.gasStations,
    spawns: w.spawns,
    districts: w.districts,
    beachY: w.beachY,
  };
}

export function unpackWorld(p) {
  const TILE = 16;
  const buildings = p.buildings.map((a) => {
    const b = {};
    BKEYS.forEach((k, i) => (b[k] = a[i]));
    const o = BKEYS.length;
    b.door = a[o] >= 0 ? { side: a[o], t: a[o + 1] } : null;
    b.poi = a[o + 2] || null;
    b.open = !!a[o + 3];
    b.sign = a[o + 4] || null;
    b.water = !!a[o + 5];
    return b;
  });
  const nodes = p.nodes.map((a) => ({
    id: a[0], tx: a[1], ty: a[2], tw: a[3], th: a[4], edges: a[5], signal: !!a[6], cross: !!a[7], inter: !!a[8], district: a[9],
    x: (a[1] + a[3] / 2) * TILE, y: (a[2] + a[4] / 2) * TILE, w: a[3] * TILE, h: a[4] * TILE,
  }));
  const edges = p.edges.map((a) => ({
    id: a[0], a: a[1], b: a[2], dir: a[3] === 0 ? 'h' : 'v', w: a[4], art: !!a[5], bridge: !!a[6], lanes: a[7], x0: a[8], y0: a[9], x1: a[10], y1: a[11],
  }));
  return {
    ...p,
    ground: fromB64(p.ground),
    district: fromB64(p.district),
    buildings,
    nodes,
    edges,
  };
}
