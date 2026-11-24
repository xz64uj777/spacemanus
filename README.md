# Orbital: Flight & EVA

A browser-playable Three.js spacecraft game with a two-mission campaign. Pilot a crewed shuttle through a close orbital-relay rendezvous, dock at low relative speed, then leave the vehicle for a tethered repair EVA. Complete that assignment to unlock a much longer lunar transfer and a rendezvous with a polar outpost. Mission distances are represented by an intentionally scaled flight world, while the HUD reports the campaign's nominal kilometres; this is a realistic-leaning game simulation, not an ephemeris or full orbital-mechanics solver.

```bash
pnpm install
pnpm dev       # Vite; this project defaults to port 3000 (Cloud supplies HOST/PORT)
pnpm typecheck # TypeScript diagnostics
pnpm test      # Unit tests for campaign, docking, EVA, inputs, saves and UI
pnpm build     # Restore registered GLBs, build dist/, run source/size checks and sharing preparation
pnpm smoke     # After build: browser playthrough of both missions, settings and EVA
```

`pnpm smoke` writes local screenshots under `shots/`. It maps registered `/manus-storage/` addresses to the corresponding checked-in source assets only in its test browser; the production bundle still references the registered stable URLs and does not include model binaries.

## Gameplay and controls

The first flight is **Relay Seven**, a 240 km close-orbit rendezvous. Thrust and RCS-in to the capture envelope, reduce relative speed below the docking limit, then use the tethered suit thrusters to reach the relay's sun-sensor panel before suit oxygen runs low. Repairing it records campaign progress and unlocks **South Pole Outpost**, a 384,400 km lunar rendezvous with a distinct surface habitat target. Campaign completion and preferences are stored locally in the browser; there is no server or account requirement.

- **Keyboard:** `W` / `S` forward and reverse thrust; `A` / `D` RCS strafe; `Space` / `C` rise and fall; `Q` / `Z` roll; `Shift` boost; `Ctrl` retro-brake; `E` dock, start the EVA or service the panel; click the flight view for mouse attitude; `Esc` pause.
- **Gamepad:** left stick and D-pad translate; right stick controls attitude; `A` rise; `B` fall / close a menu overlay; `Y` interact; `LT` brake; `LB` boost; `Start` pauses. The original standard dash and sprint bindings remain available in the shared input layer.
- **Touch:** left-side floating stick for translation, right-side drag for attitude, and on-screen rise, fall, boost and brake controls. The context button can dock or perform the available EVA interaction.

Settings on mission control include music and effects levels, look sensitivity and inversion, graphics quality, audio mute and reduced camera motion. Flight Controls includes the keyboard and controller reference. The in-game interface is intentionally English-only; matching English/Chinese dictionaries are kept in sync for the starter's localization parity checks.

## Project layout

| Path | Responsibility |
| --- | --- |
| `src/game/game.ts` | Three.js scene, inertial flight, docking, EVA movement/tether/oxygen, target models and HUD telemetry |
| `src/game/missions.ts` | Near/far mission definitions, docking/service envelopes and local campaign progression rules |
| `src/game/config.ts` | Gameplay source defaults for flight and EVA |
| `src/game/tuning.ts` | Preview Tweak parameters consumed by the simulation |
| `src/game/model-urls.ts` | Explicit runtime addresses for registered spacecraft, astronaut and favicon assets |
| `src/engine/input.ts` | Shared keyboard/mouse, standard gamepad and touch input state |
| `src/engine/assets.ts` | Cached GLTF loading and model-load progress |
| `src/engine/renderer.ts` | WebGL renderer, quality presets and viewport handling |
| `src/engine/audio.ts` | Web Audio buses, generated ambient score and synthesized effect cues |
| `src/ui/orbital-ui.ts` | Mission control, saved settings, accessible dialogs, flight/EVA HUD and debrief |
| `src/ui/touch.ts` | Touch stick, right-side look and hold-to-thrust buttons |
| `src/styles/orbital.css` | Mission-control visual system, responsive instruments and touch HUD |
| `src/i18n/en.json`, `src/i18n/zh-CN.json` | Paired dictionaries with tested key/placeholder parity |
| `assets.lock.json` | Registered purpose groups and stable storage metadata (generated fields are preserved) |

## Tweak and saves

Flight acceleration/translation, cruise speed, boost, braking, rotation, EVA thrusters and EVA speed are live Preview Tweak controls. Docking limits, tether length and oxygen supply activate at the next mission start. Tweak values are Preview state rather than saved user preferences; GAMEPLAY changes latch the existing unranked-preview guard. Normal user preferences use the starter's versioned settings store. The independent campaign record is saved at `orbital.campaign.v1` in local storage.

The main simulation changes in fixed steps. Pure mission rules stay in `src/game/missions.ts` with unit tests. Preserve the shared engine systems, the runtime-managed asset lock, purpose-based asset groups, the Vite tuning plugin and game-specific sharing helpers when extending the project.

## Credits and licensing

The Orbital shuttle and EVA suit are registered GLB models; the orbital relay and lunar habitat are assembled from Three.js geometry. The game's custom 256 px favicon is registered in the `game-identity` asset group. The project uses Three.js (MIT), the inherited Rapier engine dependency (Apache-2.0), and bundled Manus CC0 fonts; font licensing is in `public/fonts/ManusCC0-LICENSE.txt`.


## GitHub Pages

The `main` branch deploys with GitHub Actions. After the deployment workflow succeeds, play at <https://xz64uj777.github.io/spacemanus/>. The Pages workflow uses `pnpm github:build` and the bundled shuttle, astronaut, and favicon files; normal Manus Preview asset paths remain unchanged.
