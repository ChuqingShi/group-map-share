# Groupz

See where your crew is, live, on a shared game-style map. Say how you feel, plant a flag
("lunch here?"), and everyone can say yes, no thanks, or "how about somewhere else".

**Live app: <https://group-map-share.onrender.com/>**

## How to join: scan, allow location, done

1. Scan the event's **QR code** (or open its link).
2. Tap **Join** and **allow location** in your browser.
3. That's it. You're on the map.

No account, no app to install, no phone number or email, and **nothing to share but your location**.
Contact info on your card is entirely optional.

<img src="docs/screenshot.png" width="320" alt="Two players on the beach in Santa Monica">

## Features

- **One-tap join.** The app remembers your events: close it, reopen it, and you're back in the same one. Leave erases you.
- **Moods.** Tap a common one or type your own, with any emoji or none. What you say with Talk sets your mood too.
- **Flags.** Drag the 🚩 button onto the map. A restaurant under it names itself. One tap plants it and pings the crew;
  everyone who says **I'm in** gets a dotted treasure trail to it.
- **Say no thanks or suggest something else** on any invitation.
- **Talk.** Say "let's go eat at Joe's Tacos": a thought bubble, your mood, and a flag if the place is on the map.
- **Cards.** Tap anyone's picture or name for their mood, optional contact line and flags. You can edit your own.
- **Organizers.** Tick "I'm an organizer" when you join; while anyone has, only organizers plant flags or rename the event.
- Sound effects, notifications, keep-screen-on and a built-in test mission, all in Settings.

## Tech stack

| Part | What |
| ---- | ---- |
| Client | React 19, TypeScript, Vite, MapLibre GL 6 |
| Map | OpenFreeMap vector tiles (OpenMapTiles, © OpenStreetMap), custom "game board" style, Mapzen terrain, Natural Earth |
| Server | Node 24 running TypeScript directly, `ws` WebSockets, in-memory rooms (nothing written to disk) |
| Browser APIs | Geolocation, Web Audio, Speech Recognition and Synthesis, Wake Lock, Service Worker notifications |
| Sounds | ElevenLabs sound effects (`scripts/gen-sfx.py`) |
| Tests | `node:test`; real-browser scenes with `playwright-core` on installed Chrome |
| Hosting | Render (`render.yaml`) |

```
src/      React app (App, MapView, Crew, Meetups, PersonCard, FlagDrag, places, bubble, events, useRoom...)
server/   index.ts (HTTP + WebSocket), rooms.ts (rooms, moods, flags, organizers), security.ts
shared/   protocol.ts (message types for both sides)
e2e/      browser scenes          docs/   design notes and testing guide
```

## Run it

Needs Node 24.

```bash
npm install
npm run dev          # Vite on :5173, realtime server on :8787 (proxied)
npm run build && npm start   # production, one process on :8787
```

| Env var | Meaning |
| ------- | ------- |
| `GMS_PORT`, `GMS_HOST` | Port (default 8787) and interface (default 0.0.0.0). `PORT` is only honoured on Render |
| `GMS_HOST_KEY` | Optional. When set, only a browser that opened `/?host=<key>` once can start events; joining stays open to anyone with a link |
| `GMS_TRUSTED_HOPS` | Proxies in front of the server (default 1) |
| `GMS_ALLOWED_ORIGINS` | Extra hosts allowed to open WebSockets |

On Render: set `GMS_HOST_KEY` if strangers shouldn't be able to start events. Rooms live in memory, so keep one
instance; a restart or the free plan sleeping ends all events (people just start a new one).
`scripts/demo.sh` starts a local demo with a host key and can open a Tailscale Funnel link (`--public`).

## Test it

Add `?sim` to a URL to fake GPS (`?sim=LAT,LNG` to start elsewhere); open two windows on the same room to see two players.

```bash
npm run typecheck
npm test        # unit and server tests
npm run e2e     # builds, then 29 scenes in two phone-sized Chromes (about two minutes)
```

Phones need HTTPS for location; `localhost` counts. On iPhone, add the page to the Home Screen for notifications.

## Privacy and security

- Server memory only: moods, flags, positions and contact lines vanish on restart, 3 hours after the last person
  leaves, and when you leave. Close the app and your location is forgotten after 5 minutes.
- On your device: your events, name, character, optional contact line, recent moods and settings.
- Everything people type is shown as plain text. Talk uses your browser's speech service (Chrome may send audio to
  Google); typing always works, and turning words into a bubble or flag happens on your device.
- The room link is a random 128-bit key. Public hosting adds an optional host key, an origin check, per-address and flood
  limits, security headers and tests for the crash bugs review found.

**Limits:** location and alerts only work while the app is open (web apps can't track in the background); trails are
curves, not street routes; organizer status is self-declared.
