# Spritebound design notes

This document records the decisions behind the game and the research they came from. Code comments point
here when a number needs context.

## Pillars

1. **Cozy first.** Warm palettes, soft lighting, low stakes. Getting knocked out costs a small clinic bill,
   not your progress. Police chases are exciting but easy to escape. Passive mode makes PvP opt-in.
2. **Readable from above.** Every object must read at 16 px per tile from a top-down camera, day and night.
   Silhouettes, emissive accents and shadows carry readability more than texture detail.
3. **Social by default.** Shared radio, proximity voice, waving, races with leaderboards, and a city that is
   identical for everyone (one seed, deterministic generation).
4. **No build step, no assets.** Art and audio are generated in code at load time. The client is native ES
   modules served as is. This keeps the download small (about 140 KB of world data, gzipped) and lets the
   world change by changing a seed.

## Units

- 1 tile = 16 world units. The city is 512 x 512 tiles (8192 units).
- 8 world units = 1 metre, so the city is about 1 km across and a 40-unit sedan is 5 m long.
- Speeds are units per second. The HUD shows km/h as `units / 8 * 3.6`.

## Art direction

- **Sprite stacking.** Props, vehicles and characters are voxel models sliced into horizontal layers. Each
  layer is a textured quad drawn at its height, so models rotate freely and catch light and shadow like 3D
  objects while keeping hard pixel edges. Buildings are real extruded meshes with procedural facades.
- **Perspective camera.** A straight-down perspective camera (`PERSPECTIVE = 3.3`, about 17 degrees half
  field of view) gives towers visible walls near the screen edges, which sells height without breaking the
  top-down read. The view matrix contains a reflection (screen y down, z toward the viewer), so face culling
  stays off.
- **Fat-pixel sampling.** Textures use a fat-pixel filter (nearest texel in the interior, a one screen pixel
  linear blend at texel edges) so pixel art stays crisp at any zoom without shimmering.
- **Palette.** Warm key light and cool fill: golden sun, blue-violet shadows and night ambient, amber street
  lamps, cyan Sprites. Saturation rises at golden hour and drops at night and in rain.

## Rendering pipeline

All passes are WebGL2.

1. **G-buffer.** Albedo (RGBA8, alpha holds a material code) and emissive (RGBA16F). Material codes
   identify ground, roof, wall facings, foliage, water and unlit surfaces, which later passes use for
   normals and special shading.
2. **Sun shadows.** A half-resolution pass traces from each pixel toward the sun through the building
   heightmap (one texel per tile). It uses an exact grid traversal (Amanatides and Woo, *A Fast Voxel
   Traversal Algorithm for Ray Tracing*, 1987). Heights are constant per tile and the ray only climbs, so
   testing the ray height where it enters each tile is exact. Earlier fixed-step marching produced
   staircase edges on long morning shadows; the traversal gives straight edges at the same cost. A small
   height tolerance that grows with distance softens the far end of each shadow.
3. **Sprite shadows.** Sprites are re-rendered flattened along the sun vector into a caster-height buffer.
   Low surfaces darken where a taller caster covers them.
4. **Point and cone lights.** Deferred, half resolution, additive. Falloff is a windowed inverse square,
   `saturate(1 - x^4)^2 / (1 + 5 x^2)` with `x = distance / radius`, the same family as the UE4 and
   Frostbite falloff, which reaches exactly zero at the radius so lights can be culled by their quad.
   Street lamps and headlights are occluded by a short march through the heightmap so light does not leak
   through buildings.
5. **Composite.** `albedo * (ambient + sun + lights) + emissive`, plus cloud shadows projected along the sun
   direction, water glints, and rain puddles that reflect the light buffer.
6. **Particles.** Forward pass into the HDR target: smoke, sparks, rain, skid dust, fire, glows.
7. **X-ray silhouettes.** The perspective camera lets tall buildings hide players in alleys, which is
   geometrically right but bad for play. The local player, their car and other players are redrawn as a
   flat tinted silhouette wherever something at least 10 units in front of them (in view distance) covers
   them. The threshold ignores a sprite's own stacked slices.
8. **Bloom.** Dual Kawase filter (Bjorge, *Bandwidth-Efficient Rendering*, SIGGRAPH 2015): cheap, wide and
   stable, which matters for small emissive pixels.
9. **Tone mapping and grading.** ACES filmic fit (Narkowicz, 2015), then saturation, contrast, lift and gain
   from the time-of-day table, vignette and optional damage tint.

### Time of day

`client/js/gfx/lighting.js` interpolates keyframes with smoothstep:

| Hour | Mood |
| --- | --- |
| 0 to 4 | Deep blue night, moon light from the south-west |
| 5.5 | Blue hour, no direct light |
| 6.25 to 7.5 | Sunrise: orange key, violet ambient, saturation up |
| 10 to 16 | Neutral daylight, slightly warm |
| 18 to 19.25 | Golden hour: strongest warmth and saturation |
| 20 | Blue hour again, lamps on |
| 22 | Night |

Lamps fade in from 18.4 to 19.4 and out from 5.8 to 7.0. Window lighting ramps up through the evening and
thins out after 22:00 as the city goes to sleep. Weather scales the sun down and blends ambient toward grey.

## Vehicles

Car handling is the heart of the game, so it got the most tuning time. The model lives in
`shared/carphysics.js` and runs identically on the client (for the driven car) and the server (for traffic
and police).

- **Model.** One rigid body with a kinematic bicycle yaw target (`v / wheelBase * tan(steer)`), approached
  at a limited rate. Lateral velocity is removed by a capped impulse per step, which is what makes the car
  slide instead of turning on rails once the cap is exceeded. This follows the arcade school of top-down
  car games rather than a tyre model (see Marco Monster, *Car Physics for Games*, 2003, for the full
  version this simplifies).
- **Drift.** Hysteresis on slip: a drift starts above a slip threshold or with the handbrake, and ends only
  once slip falls well below it. While drifting, grip and self-aligning torque drop and the yaw response
  softens, which keeps drifts controllable and long.
- **Steering.** Maximum steer angle falls off with speed. Steering returns to centre faster than it moves
  away from it.
- **Drag.** Quadratic air drag plus rolling resistance, solved so the car reaches exactly its listed top
  speed under full throttle.
- **Targets.** Reaching 90 percent of top speed takes about 3 seconds. Full braking from cruise speed takes
  about 140 units (17 m). These were tuned by playing, after the first pass felt twitchy.
- **Collisions.** Oriented boxes against the world and against each other, with impulses split by mass.
  Hard hits stun the steering briefly and damage the car.

## Networking

- **Transport.** One WebSocket per player. JSON for events, a packed binary snapshot for entity state.
- **Snapshots.** 20 Hz. Each client receives only entities within 1150 units (interest management).
  Static per-entity info (appearance, model, colour) is sent once per version, not every snapshot.
- **Interpolation.** Remote entities render 110 ms in the past, interpolated between snapshots.
- **Authority.** Movement is client-authoritative with server validation: maximum distance per elapsed
  time, no positions inside buildings, and a teleport counter so stale packets after a correction are
  ignored. This keeps driving perfectly responsive at any ping, which matters more for a cozy game than
  perfect cheat resistance.
- **Hits.** Favor the shooter: the client reports a hit, the server checks range, line of sight, fire rate
  and ammo. Compare the lag compensation discussion in Bernier, *Latency Compensating Methods in
  Client/Server In-game Protocol Design and Optimization* (Valve, 2001).
- **Abuse limits.** A token bucket per connection (90 messages per second, burst 120), 64 KB message cap,
  open connections capped per IP, name and chat filters, and every purchase and pickup validated by
  position on the server.

## Traffic, pedestrians and police

- **Traffic** follows a lane graph built from the road network. Turns use Bezier curves through the
  intersection. Signals share one phase clock per intersection, so all players see the same lights. Cars
  probe ahead a distance that grows with speed and brake for what they find (a simplified car-following
  model in the spirit of IDM). Blocked cars honk. A car knocked by a player becomes a physics body, then
  steers back into its lane.
- **Pedestrians** walk sidewalks and park paths, wave at players, flee from gunfire and danger, and can be
  knocked down. They respawn out of sight.
- **Police.** Crimes add heat; witnesses scale it (police in line of sight count fully, civilians partly,
  unseen crimes barely). Stars unlock at 20, 60, 150, 350 and 700 heat. Staying out of police sight for 12
  to 60 seconds (more with more stars) clears the level. Units route to the player over the road graph with
  breadth-first search, then deploy officers on foot.

## Audio

Everything is synthesized with Web Audio at runtime.

- **Mix.** Buses for SFX, ambience, music and voice into a compressor. A generated convolution reverb and a
  slapback delay give downtown its echo.
- **Positional sound.** Equal-power stereo pan, distance gain and a low-pass filter that closes with
  distance. The listener follows the camera.
- **Engines.** Layered oscillators and filtered noise driven by a simulated gearbox, so revs climb and drop
  with shifts. Tyre screech follows lateral slip.
- **Radio.** Four procedural stations (lo-fi, synthwave, chiptune, jazz). Song choice and position derive
  from server time, so everyone tuned in hears the same song at the same moment.
- **Ambience.** Blended by surroundings: city hum, birds in parks, waves near the coast, rain, thunder.

## Proximity voice

- **Topology.** Peer-to-peer WebRTC mesh. The server decides links: players link within 640 units and
  unlink beyond 832 after a 1.5 second grace period, and a link lives at least 4 seconds. Each player has at
  most 8 links, nearest first, so bandwidth stays flat in crowds.
- **Negotiation.** The perfect negotiation pattern from the WebRTC specification examples, with a
  connection id per link so late signals from an old link are dropped. Only the impolite peer makes the
  first offer, with a single sendrecv transceiver; the polite peer attaches its microphone to that
  transceiver before answering. When both sides offered at once, the polite side's implicit rollback
  sometimes left Chromium's ICE gathering stalled with no local candidates (about one link in five in
  testing). With one offerer, links connect in a single round trip. Mic changes swap the sender track
  with `replaceTrack`, so they never renegotiate.
- **Playback.** Each remote stream is attached to a muted `audio` element as well as Web Audio. Chromium
  does not feed a remote WebRTC stream into Web Audio unless a media element consumes it.
- **Distance.** Full volume within 60 units, quadratic fade to silence at 580, stereo pan by horizontal
  offset.
- **Opus.** The remote description is adjusted to request in-band FEC, DTX and mono at 28 kbit/s: clear
  speech, resilient to loss, cheap.
- **TURN.** Credentials follow the TURN REST API scheme (`expiry:userId` signed with HMAC-SHA1), which
  coturn supports with `use-auth-secret`. They are valid for 8 hours.
- **Talking.** Push-to-talk toggles `track.enabled`, so no renegotiation happens. Open mic uses an RMS
  voice activity detector with hysteresis and a hold time.

## Economy

- New players start with $500. Deliveries and fares pay by distance plus a speed bonus, roughly $50 to $200
  each. Races pay up to $400 with a course record. Collectibles pay $150 each, with bonuses every 10.
- Cars cost $9,000 to $52,000, so the first car takes an hour or two of jobs: a clear early goal.
- Getting knocked out costs 5 percent of cash (at most $200). Getting busted costs 10 percent (at most $500).

## Testing

- `npm test` runs the server simulation headless: traffic flow, pedestrians, police response, shops,
  carjacking and dev command gating.
- `tools/play.mjs` drives the real client in headless Chromium: join, walk, enter and drive a car, drift,
  shoot, open the map, then night, storm and morning screenshots.
- `tools/duo.mjs` runs two real clients: they meet, see each other, chat, connect proximity voice,
  walk apart (link drops) and meet again (link returns).
- `tools/bots.js` connects many headless clients for load and protocol checks. With 32 bots walking
  around, the server used 6 to 17 percent of one core and about 135 MB of memory, and each client received
  about 17 KB/s.
- `tools/audio-probe.mjs` plays every synthesized sound in the browser and fails on silence or errors.
