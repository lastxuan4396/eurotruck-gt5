# Euro Truck GT5 Fusion

A browser driving game prototype that blends Euro Truck-style heavy vehicle handling with GT-style racing systems.

## Features

- Three camera views: `1` cockpit-like view, `2` top navigation view, `3` chase view
- Truck driving physics: throttle, brake, steering, lane offset control
- World setup presets: city (`Alpine/Coast/Industrial`), weather (`clear/rain/fog`), day phase (`day/sunset/night`)
- GT-inspired systems:
  - Dynamic racing line (green/yellow/red guidance)
  - Sector + lap timing
  - TCS / power map / brake bias setup
  - Clean Drive score + GT Points + final grade
- License mode (`A/B/IB/IA` style challenges) with slalom/precision/clean objectives
- Logistics contract loop: route progress, delivery deadline, payout + persistent wallet
- Ghost best-lap replay with compare offset mode
- AI traffic and collision penalty model

## Controls

- Steer: `A` / `D` or `←` / `→`
- Throttle / Brake: `W` / `S` or `↑` / `↓`
- Camera: `1` / `2` / `3` or `C` / `B`
- Ghost toggle: `G` or `Enter`
- Ghost compare mode: `V` or `Space`
- Pause: `Esc`
- Reset truck: `R`
- Fullscreen: `F`

## Local Run

```bash
python3 -m http.server 4173 --directory .
```

Open `http://127.0.0.1:4173`.

## Render

This repository includes a `render.yaml` Blueprint for a static site deployment.

## GitHub Positioning

- Suggested description: `Browser driving game prototype blending truck simulation and GT-style racing systems.`
- Suggested topics: `browser-game`, `driving-game`, `simulation`, `html`, `css`, `javascript`
- Metadata notes: see [`docs/repo-metadata.md`](docs/repo-metadata.md)

