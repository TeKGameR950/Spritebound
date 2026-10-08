export class Game {
  constructor(world, config) {
    this.world = world;
    this.config = config;
    this.started = Date.now();
  }
  connect(ws) {
    ws.close();
  }
  status() {
    return { players: 0, uptime: (Date.now() - this.started) / 1000 };
  }
  shutdown() {}
}
