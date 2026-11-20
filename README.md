# Cyber Ops: Cold Archive

A two-player asymmetric co-op stealth-infiltration game that runs entirely in the browser (and installs as a PWA for offline solo play).

**▶ Play it live: https://r0n1n9.github.io/coldarchive/**

## What it is

A whistleblower evidence-recovery op. One player is the **field agent** on the ground; the other runs the **Overwatch (CyberOp) console** — hacking doors, cutting lights, dropping supplies, deploying drones and reviving the agent. There's also a **Versus** mode where one player *is* the datacenter (command guards and drones, lock down, spike the operator's feed), and solo play against the AI.

### Modes
- **Field agent + AI overwatch** / **Overwatch + AI agent** — solo vs AI.
- **Commander** — drive both roles, toggle with Tab.
- **Split-screen (chessboard)** — two players on one tablet facing each other across a top/bottom divider:
  - Two agents
  - Overwatch + agent
  - Both can swap roles (agent ↔ console)
  - Facility vs Strike team
- **Versus** — play the facility against an AI strike team.
- **Agent range** — practice.

## Running locally

It's a static site — no build step. Serve the folder with any static server, e.g.:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

> The service worker and co-op (WebRTC/PeerJS) need an `http(s)://` origin, so use a local server rather than opening `index.html` as a `file://` URL.

## Files

- `index.html` — HUD, styles, and page shell
- `game.js` — the game engine (single IIFE)
- `manifest.webmanifest`, `sw.js`, `icons/` — PWA install + offline app shell
