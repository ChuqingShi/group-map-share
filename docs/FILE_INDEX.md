# File index

What each file in the project does. Entry points are marked **(entry)**.

To go the other way, from something you see on screen to the code behind it, use `docs/COMPONENTS.md`.

## Root

| File | What it does |
| ---- | ------------ |
| `package.json` | Dependencies and scripts (`dev`, `build`, `start`, `test`, `e2e`, `check`) |
| `index.html` | **(entry, client)** HTML shell; loads `src/main.tsx` |
| `vite.config.ts` | Vite build config; in dev, proxies `/api` and `/ws` to the server on :8787 |
| `tsconfig.json` | TypeScript settings for `src/`, `server/`, `shared/` and `test/` |
| `render.yaml` | Render deployment blueprint: one Node web service, single instance |
| `README.md` | Product overview, how to run, env vars, privacy notes |
| `.gitignore` | Ignores `node_modules/`, `dist/`, `.env*`, e2e artifacts, demo host key |

## `server/`: Node HTTP + WebSocket server

| File | What it does |
| ---- | ------------ |
| `index.ts` | **(entry, server)** HTTP routes (`/api/rooms`, `/api/health`, `/api/version`), serves built `dist/` in production, opens `/ws` and dispatches each message type to `RoomRegistry` |
| `rooms.ts` | Core logic: `RoomRegistry` holds all rooms, players, moods and plans in memory, validates input, enforces rules (limits, organizers) and broadcasts updates |
| `security.ts` | Caller IP detection, host-key check, origin check, connection/rate limiters, security headers |
| `config.ts` | Reads port/host/static-serving settings from environment variables |
| `persist.ts` | Optional: saves rooms to a JSON file (when `GMS_DATA_DIR` is set) so restarts don't end events |

## `shared/`: used by both sides

| File | What it does |
| ---- | ------------ |
| `protocol.ts` | The client↔server contract: message types (`ClientMsg`, `ServerMsg`), data shapes (`Player`, `Plan`, `Mood`), constants and limits |

## `src/`: React client

### App shell and state

| File | What it does |
| ---- | ------------ |
| `main.tsx` | **(entry, client JS)** Mounts `<App />` inside `ErrorBoundary`, registers the service worker |
| `App.tsx` | Top-level controller: landing page, join screen, room page; holds most UI state and wires everything together |
| `ErrorBoundary.tsx` | Shows a friendly reload card if a screen crashes |
| `useRoom.ts` | WebSocket connection hook: sends messages, keeps `players`/`plans` in sync, reconnects with a resume token |
| `useGeolocation.ts` | Wraps browser GPS; `?sim` in the URL fakes movement for testing |
| `startLocation.ts` | Decides where the map opens (asks for location up front) |
| `events.ts` | "My events": remembers joined events in localStorage so reopening resumes them |
| `safeStorage.ts` | localStorage wrapper that never throws |

### Map

| File | What it does |
| ---- | ------------ |
| `MapView.tsx` | Renders the MapLibre map: player pins, flags, trails, bubbles |
| `mapStyle.ts` | Custom "game board" map style over OpenFreeMap tiles |
| `map-extras.css` | Styles for things drawn on the map (X marks, bubbles, mood badges) |
| `treasure.ts` | Pure geometry for treasure-trail dots |
| `meetup.ts` | Pure helpers: spoken sentences, walking time, curved trail paths |
| `geo.ts` | `LatLng` type and distance math |
| `places.ts` | Finds named restaurants/bars among map points (to name flags, match Talk) |

### UI components

| File | What it does |
| ---- | ------------ |
| `Meetups.tsx` | Sheets for moods, meetup plans (flags) and Talk |
| `Crew.tsx` | Avatar strip along the top and toast pop-ups |
| `PersonCard.tsx` | Card shown when tapping a person |
| `PlaceCard.tsx` | Card shown when tapping a restaurant/cafe/bar |
| `FlagDrag.tsx` | Flag button: tap for list, drag onto the map to plant |
| `Quest.tsx` | First-mission screens (intro, progress chip, checklist) |
| `quest.ts` | First-mission steps, state and logic |
| `styles.css` | Global app styles (retro game-manual look) |

### Device features (no network)

| File | What it does |
| ---- | ------------ |
| `useSpeech.ts` | Speech-to-text for the Talk button |
| `bubble.ts` | Turns spoken/typed words into a short thought bubble (rule-based) |
| `voice.ts` | Spoken announcements via speech synthesis |
| `sfx.ts` | Sound effects via Web Audio |
| `notify.ts` | Local notifications while in an event |
| `keepAwake.ts` | Keeps the screen on while sharing location |

## `public/`: static files served as-is

| File | What it does |
| ---- | ------------ |
| `sw.js` | Service worker, only for notifications (caches nothing) |
| `manifest.webmanifest` | PWA manifest (Add to Home Screen) |
| `favicon.svg`, `icon.svg`, `icon-192.png`, `icon-512.png` | App icons |
| `sfx/*.mp3` | Sound effects (join, ping, plant, mood, etc.) |

## `test/`: unit and server tests (`npm test`)

| File | What it tests |
| ---- | ------------- |
| `server.test.ts` | HTTP and WebSocket server behavior |
| `rooms.test.ts` | `RoomRegistry` rules and state |
| `security.test.ts` | Limiters, origin/host-key checks, crash fixes |
| `persist.test.ts` | Saving/restoring rooms |
| `config.test.ts` | Env var parsing |
| `meetup.test.ts`, `meetups.test.ts` | Meetup helpers and plan flows |
| `treasure.test.ts`, `places.test.ts`, `bubble.test.ts`, `events.test.ts`, `quest.test.ts`, `sfx.test.ts`, `style.test.ts` | The matching `src/` modules |

## `e2e/`: real-browser tests (`npm run e2e`)

| File | What it does |
| ---- | ------------ |
| `harness.ts` | Starts the production server and drives Chrome via `playwright-core` |
| `tsconfig.json` | TypeScript settings for the e2e folder |
| `*.e2e.ts` | Scenes by feature: `smoke`, `phone`, `maps`, `mood`, `plans`, `talk`, `cards`, `events`, `gestures`, `settings`, `persist`, `resilience` |

## `scripts/`

| File | What it does |
| ---- | ------------ |
| `demo.sh` | Builds and starts a local demo with a host key; `--public` opens a Tailscale Funnel link |
| `gen-sfx.py` | Generated the sound effects with ElevenLabs |

## `docs/`

| File | What it does |
| ---- | ------------ |
| `TESTING.md` | Testing guide |
| `MEETUPS.md` | Design notes for moods, flags, trails, bubbles |
| `TEST_MISSION_PLAN.md` | Plan for the 7-step first mission: each step, the code that ticks it, and how it is tested |
| `FILE_INDEX.md` | Table of every project file and what it does, grouped by folder, with entry points marked |
| `TECH_STACK.md` | Every library, runtime, browser API and outside service, and which feature uses it |
| `TODO.md` | Task list with checkboxes, ordered by the pages a user goes through |
| `COMPONENTS.md` | Table of everything a user can see or tap, by page and screen area, with its code name and file; organizer-only parts marked |
| `screenshot.png` | README screenshot |
| `ci/ci.yml` | GitHub Actions CI workflow, parked here until moved to `.github/workflows/` |
| `email/approve-request.html`, `email/preview.png` | HTML email template for PR-approval requests, and its preview |
