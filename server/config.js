const env = process.env;
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);
const bool = (v, d) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(v));

export const config = {
  port: num(env.PORT, 3000),
  host: env.HOST || '0.0.0.0',
  seed: num(env.WORLD_SEED, 1337),
  serverName: env.SERVER_NAME || 'Haven Bay',
  motd: env.MOTD || 'Welcome to Haven Bay! Be kind, have fun.',
  maxPlayers: num(env.MAX_PLAYERS, 48),
  maxConnPerIp: num(env.MAX_CONN_PER_IP, 8),
  pvp: bool(env.PVP, true),
  dataDir: env.DATA_DIR || 'data',
  // Proximity voice: STUN by default; TURN is optional and strongly recommended in production.
  stunUrls: (env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',').filter(Boolean),
  turnUrls: (env.TURN_URLS || '').split(',').filter(Boolean),
  turnSecret: env.TURN_SECRET || '',
  turnUser: env.TURN_USERNAME || '',
  turnPass: env.TURN_PASSWORD || '',
  trafficPerPlayer: num(env.TRAFFIC_PER_PLAYER, 14),
  pedsPerPlayer: num(env.PEDS_PER_PLAYER, 22),
  dayLength: num(env.DAY_LENGTH, 24 * 60),
  trustProxy: bool(env.TRUST_PROXY, false),
  dev: bool(env.DEV, false),
};
