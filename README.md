# DEAD SHIFT

A first-person zombie survival game set in a factory, wrapped in a free-roam night district — built for the web with Three.js, TypeScript and Vite. One static build, no backend, every sound synthesised live with the Web Audio API.

**Play:** pick **Zombie Waves** or **Free Roam** from the main menu.

## What's in it

- **Factory waves** — a 76×56 m two-level factory (machine floor, mezzanine, conveyor, forklift, explosive barrels, four spawn doors, wall buys). Zombies — Walkers, Runners, Brutes, Spitters — path with grid A*, steering and separation. Wave scaling, 20-second intermissions, drops, boss bar for Brutes.
- **Five weapons** — P-9 pistol, VK-9 SMG, AR-15 carbine, M870 pump shotgun (8 pellets), Longshot DMR — each with its own damage/fire-rate/spread/falloff/recoil table, ADS, tactical-vs-empty reloads credited at the mag-seated point, swap-cancels, melee, hitmarkers and headshot multipliers.
- **Open district** — a 600×600 m night district around the factory: 5×5 blocks, lit buildings, streetlights, 24 wandering pedestrians, 20 hidden neon orbs ($100 each), and four interiors — factory, gun shop, clinic (heal + save) and the Velvet Room club.
- **The Velvet Room** — M-rated, GTA-style club: stage with pole dancers, tip rail ($5 bills, Like meter), bar with rotating tips, private booths ($40 dance, flirt meter, bouncer patrols, double-dance invitation at Like 100). Costumed dancers only — no nudity. 18+ notice and a "reduce club content" setting included.
- **Cars** — 18 parked cars plus 12 traffic cars on looped circuits. Kinematic bicycle-model driving, chase and hood cameras, headlights, engine/skid/crash audio, car damage and smoke, run-over damage, stealable traffic cars, F to recover a stuck car.
- **Phone & map** — press **P** for a working phone: district map with click-to-set waypoint and GPS route, messages that arrive as the game happens, contacts with real effects (cab fast-travel $25, ammo drop $150, clinic, club booker $40, mechanic $100), bank ledger, checklist, camera (downloads a PNG of your view). Full map on **M**, live circular minimap in the HUD.
- **Full game shell** — animated main menu over the live district, pause, game over with run stats, how-to-play, credits, and settings (sensitivity, FOV, quality, difficulty, four volume buses, subtitles, head-bob, vignette, club content, crouch style) persisted to localStorage along with your save.
- **Audio** — zero audio files. Gunshots voiced per weapon, reload foley timed to the reload, zombie groans, factory hum, district wind, a 122 BPM club loop that muffles through the walls, car engines, phone blips, UI.

## Controls

WASD move · mouse look · Shift sprint · Space jump · Ctrl/C crouch · LMB shoot · RMB aim · R reload · 1–5/wheel weapons · V melee · E interact / enter & exit car · P phone · M map · Esc pause. In a car: Space handbrake · C camera · H horn · F flip/reset.

## Performance

Built to a budget for mid-range laptops: merged/instanced static geometry, one shadow-casting light with a tight frustum, exponential fog at the district edge, pooled tracers/particles/zombies/cars, DPR capped at 1.5, ACES tone mapping + light bloom, and an auto-quality scaler that steps down if the frame rate drops.

## Develop

```bash
npm install
npm run dev     # local dev server
npm run build   # type-check + production build to dist/
npm test        # unit tests for weapon/wave/car/A* logic (Vitest)
```

Headless smoke tests live in `tests/smoke.mjs` / `tests/smoke2.mjs` (Playwright Core + any Chromium) and screenshots land in `shots/`.

## Tech

Three.js (WebGL2) · TypeScript · Vite · Vitest · Playwright Core (tests only). No physics engine — custom AABB/capsule collision, grid A*, kinematic cars. Deployed as a static site on Vercel.
