# Neon Drift

**Play live: https://devaxxn.github.io/MyProject/**

A neon arcade dodge-and-shoot game — pure HTML/CSS/JS, no build step, no dependencies. Fully offline-capable PWA.

## Play it

Open `index.html` in any browser — that's it. No server needed.

For the full PWA experience (installable app, offline play), serve the folder over HTTP:

```bash
python3 -m http.server 8080
# or any static host
```

## Deploy it

Every asset is referenced by **relative paths**, so the folder deploys as-is to any static host:

- **GitHub Pages** — already configured: pushes to `main` auto-publish to https://devaxxn.github.io/MyProject/ within ~1 minute
- **Other repos / hosts** — enable Pages on the root (or `/docs`), or use Netlify/Vercel/Cloudflare Pages drag-and-drop
- **Netlify / Vercel / Cloudflare Pages** — drag-and-drop the folder, or connect the repo; no build command, publish directory = project root
- **Any web server** — copy the files, done

Optional: edit `manifest.webmanifest` (`start_url`, `id`) if you host under a subdirectory other than the domain root. The service worker precaches all 9 assets automatically.

## Controls

| | Move | Fire |
|---|---|---|
| **P1** | `A` / `D`, mouse, or **touch drag (left side)** | `W` or **hold right side (touch)** |
| **P2** (2-player mode) | `◀` / `▶` | `▲` |

`1`/`2`/`3` difficulty · `S` toggle 2-player · `Space` start · `R` restart · `M` mute

## Features

- Solo or 2-player on one keyboard (per-player score, combo, lives)
- Combo multiplier scoring (up to ×5), near-miss bonuses
- 5 power-ups: SHIELD, SLOW-MO, MAGNET, **RAPID** (fire rate ×3), **NOVA** (5-way spread shot)
- **Stacking**: pickups of the same kind add duration up to a per-type cap — hit the cap for an instant bonus payout
- **OVERDRIVE** (rare white drop, ~11%, or chain 3 same-kind pickups within 5s): phase through everything, triple-fan shots, nova-potent
- Shooter **drone waves** that hunt you — blast them for bonus points (+25 × difficulty)
- **V-wave formations**: 5 orange drones sweep across in a wedge, firing as they go (+40 × difficulty each)
- **Swarm raids every 30s**: pink kamikaze mini-drones home in on the nearest player — shoot them or dodge (+15 × difficulty)
- **Boss fight every 60s** — 3 phases, aimed fire; feed it orbs or shoot it down (+250 × difficulty)
- Escalating hazards: fallers, drifters, comets
- Procedural chiptune soundtrack that speeds up with difficulty; synthesized SFX (no audio files)
- Per-mode × per-difficulty top-5 leaderboard with timestamps (saved locally)
- 3 difficulties with distinct ramp curves, lives, and score multipliers
- Full PWA: manifest, icons, service worker — installable, playable offline
