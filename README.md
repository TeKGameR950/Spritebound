# Spritebound

A cozy multiplayer top-down city sandbox in 16x16 pixel art. Cruise Haven Bay with friends, drift through
downtown at sunset, take pizza and taxi jobs, hunt 60 hidden Sprites, and talk to the people near you with
proximity voice chat. Runs in any modern browser. The server is plain Node.js.

Live at **[spritebound.world](https://spritebound.world)**.

## Features

- **A whole city.** Haven Bay is about 1 km across: downtown towers, a river, suburbs, a beach and pier,
  docks, a lighthouse point and pine hills. Twelve districts, 500+ buildings and 14,000 props, all generated
  from one seed so every player sees the same city.
- **Pixel art with real lighting.** Voxel sprite stacks seen through a perspective camera, a deferred WebGL2
  renderer with ray-marched sun shadows, warm street lamps, headlight cones, bloom, rain puddles, cloud
  shadows, thunderstorms and a full day/night cycle.
- **Cars that feel good.** 13 vehicles from scooters to the city bus, with arcade physics tuned for drifting,
  handbrake turns, skid marks, crashes and damage. Traffic follows lanes and signals and reacts when you
  bump it.
- **Character creator.** Body, skin, hair, outfits, hats and accessories with a live preview. Change your
  look later at the tailor.
- **Weapons and police.** Bat, pistol, SMG, shotgun, rifle, rocket launcher and grenades. Crimes raise a
  five-star wanted level. Lose the cops by staying out of sight, or get a respray. Passive mode keeps PvP
  opt-in.
- **Multiplayer built in.** Up to 48 players per server by default, with server-validated movement and hits.
- **Proximity voice chat.** Peer-to-peer WebRTC audio that fades and pans with distance. Push-to-talk or
  open mic.
- **Things to do.** Pizza delivery, taxi fares, time-trial races with leaderboards, car dealer, shops,
  arcade, collectibles and a big map with waypoints.
- **Procedural audio.** Every sound is synthesized live with Web Audio: engines with gear shifts, tyre
  screech, sirens, footsteps, gunfire, ambience per district, and four radio stations that play the same
  song for everyone tuned in.
- **Accounts without passwords.** Progress (money, cars, weapons, Sprites) is tied to a token stored in the
  browser.

## Quick start

Requires Node.js 18.17 or newer.

```sh
npm install
npm start
```

Open http://localhost:3000. Open a second browser window to see multiplayer.

The microphone only works on a secure origin. `localhost` counts as secure, so voice chat works locally.
On any other host you need HTTPS (see [Deploying](#deploying)).

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Walk, or drive in a car |
| Shift | Run |
| Mouse, left click | Aim and attack |
| E | Enter or leave a vehicle, use shops and jobs |
| Space | Handbrake |
| 1 to 9, mouse wheel, Z / X | Switch weapons |
| R | Reload |
| H / Q / L | Horn / siren / headlights |
| N | Next radio station |
| V | Push to talk |
| T or Enter | Chat |
| Tab | Player list |
| M | Big map (click to set a waypoint) |
| G | Call your car |
| J | Start or quit a taxi shift |
| B | Wave |
| C | Zoom out |
| Esc | Menu, settings, passive mode |

Chat commands: `/help`, `/passive on|off`, `/stuck`, `/players`, `/time`.

## Configuration

All settings are environment variables.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP and WebSocket port |
| `HOST` | `0.0.0.0` | Bind address |
| `SERVER_NAME` | `Haven Bay` | Shown on the title screen |
| `MOTD` | welcome text | Message of the day |
| `MAX_PLAYERS` | `48` | Player cap |
| `MAX_CONN_PER_IP` | `8` | Open WebSocket cap per IP address |
| `PVP` | `true` | `false` makes the server peaceful |
| `WORLD_SEED` | `1337` | City layout seed |
| `DAY_LENGTH` | `1440` | Seconds per in-game day |
| `TRAFFIC_PER_PLAYER` | `14` | Traffic cars kept around each player |
| `PEDS_PER_PLAYER` | `22` | Pedestrians kept around each player |
| `DATA_DIR` | `data` | Where `profiles.json` is saved |
| `TRUST_PROXY` | `false` | Read client IPs from `X-Forwarded-For` (enable behind a reverse proxy) |
| `STUN_URLS` | Google STUN | Comma-separated STUN URLs for voice |
| `TURN_URLS` | empty | Comma-separated TURN URLs, for example `turn:turn.example.com:3478` |
| `TURN_SECRET` | empty | coturn `static-auth-secret`; the server issues short-lived credentials |
| `TURN_USERNAME`, `TURN_PASSWORD` | empty | Static TURN credentials, used when `TURN_SECRET` is unset |
| `DEV` | `false` | Enables developer chat commands (see below) |

Changing `WORLD_SEED` builds a different city. Saved player positions are checked on join and fall back to
a spawn point if they land somewhere invalid.

## Deploying

The game is a single Node process that serves the client, the world data and the WebSocket at `/ws`.
Put it behind a reverse proxy that terminates TLS.

### Docker and Caddy

```sh
docker build -t spritebound .
docker run -d --name spritebound -p 127.0.0.1:3000:3000 -v spritebound-data:/app/data \
  -e TRUST_PROXY=true -e TURN_URLS=turn:turn.spritebound.world:3478 -e TURN_SECRET=change-me \
  spritebound
```

The included `Caddyfile` serves `spritebound.world` with automatic HTTPS and proxies WebSockets:

```sh
caddy run --config Caddyfile
```

### Without Docker

Run `npm ci --omit=dev && npm start` under a process manager. `deploy/spritebound.service` is a systemd unit.

### Voice chat in production

Voice is peer to peer. STUN alone connects most home networks, but players behind strict NATs or
corporate firewalls need a TURN relay. Install [coturn](https://github.com/coturn/coturn), start from
`deploy/turnserver.conf`, and set `TURN_URLS` and `TURN_SECRET` to match. The server hands each client
credentials that expire after 8 hours (the TURN REST API scheme coturn supports via `use-auth-secret`).

Each player connects to at most 8 nearby voice peers at a time, so bandwidth stays flat as the server grows.

### Saving and backups

Profiles live in `DATA_DIR/profiles.json`. The server writes it atomically every 15 seconds when something
changed, and on shutdown (SIGINT or SIGTERM). Back up that file.

## Development

```sh
DEV=1 npm run dev        # restarts on server changes; the client reloads on refresh
npm test                 # simulation tests: traffic, peds, police, shops, carjacking, dev commands
node tools/bots.js 16 ws://localhost:3000/ws 60   # 16 headless bots for a minute, prints traffic stats
node tools/map-preview.js 1337 map.png 2          # renders the generated city to a PNG
```

With `DEV=1`, these chat commands are available: `/tp <tileX> <tileY>`, `/car [model]`, `/money <n>`,
`/give <weapon>`, `/time <hour>`, `/weather clear|cloudy|rain|storm`, `/wanted <0-5>`.

Browser tests use Playwright (`npm i --no-save playwright`). For `duo.mjs`, set `FAKE_MIC` to a WAV file to
feed the fake microphone; Chromium's default fake device is silent in headless mode.

```sh
node tools/play.mjs http://localhost:3000 out basic   # join, walk, drive, drift, shoot, open the map
node tools/play.mjs http://localhost:3000 out night   # night, storm and morning screenshots (needs DEV=1)
node tools/duo.mjs http://localhost:3000 out          # two players: sync, chat, voice link, unlink, relink
node tools/shot.mjs http://localhost:3000 out.png      # single screenshot
```

## Project layout

```
client/            browser game (no build step, native ES modules)
  js/gfx/          WebGL2 renderer, voxel art, lighting, camera
  js/game/         game loop, local player, scene building, particles, effects
  js/audio/        Web Audio engine, synthesized SFX, engines, ambience, radio
  js/ui/           HUD, character creator, menus, shops, minimap
  js/voice.js      WebRTC proximity voice
shared/            code used by both sides: constants, protocol, car physics, collision, vehicles, weapons
server/            HTTP and WebSocket server, world generator, simulation (traffic, peds, police, combat, jobs)
tests/             node:test simulation tests
tools/             bots, map preview, browser test scripts
deploy/            systemd unit and coturn example
docs/DESIGN.md     design and research notes
```

## Browser support

Chrome, Edge, Firefox and Safari 15 or newer with WebGL2. On slower machines, lower the render scale or turn
off shadows and bloom in Settings.

## Credits

Fonts: Silkscreen and Pixelify Sans, both under the SIL Open Font License (see `client/fonts`). Everything else, including all art and sound, is generated by the game's code.
