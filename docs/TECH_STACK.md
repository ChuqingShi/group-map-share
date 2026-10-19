# Tech stack

Every library, runtime and outside service the project uses, and what it is for. Versions are the
ones installed from `package-lock.json`.

## Runtime

| What | Version | Used for |
| ---- | ------- | -------- |
| Node.js | 24.x (`engines` in `package.json`) | Runs the server. Runs TypeScript directly (no compile step), plus `node --watch` in dev and `node:test` for tests |
| TypeScript | 7.0.2 | Types across `src/`, `server/`, `shared/`, `test/`, `e2e/`. Only used to check (`tsc --noEmit`); Node and Vite strip the types themselves |

## npm dependencies (shipped)

| Package | Version | Feature | Where |
| ------- | ------- | ------- | ----- |
| `react` | 19.3.1 | All UI components, state and hooks | every `src/*.tsx`, `src/use*.ts` |
| `react-dom` | 19.3.1 | Mounts the React app into the page | `src/main.tsx` |
| `maplibre-gl` | 6.14.0 | The interactive map: tiles, pins, flags, trails, gestures. Also its web worker and CSS | `src/MapView.tsx`, `src/mapStyle.ts` |
| `qrcode` | 1.5.4 | QR code in the Invite dialog | `src/App.tsx` (`Invite`) |
| `ws` | 8.22.0 | WebSocket server for live rooms | `server/index.ts` |

## npm dev dependencies (build, dev and test only)

| Package | Version | Used for | Where |
| ------- | ------- | -------- | ----- |
| `vite` | 8.3.4 | Dev server on :5173 (proxying `/api` and `/ws`) and production build into `dist/` | `vite.config.ts`, `npm run dev` / `build` |
| `@vitejs/plugin-react` | 6.1.2 | JSX and fast refresh for React in Vite | `vite.config.ts` |
| `concurrently` | 10.0.6 | Runs server and Vite together in one terminal | `npm run dev` |
| `typescript` | 7.0.2 | `tsc` type checking | `npm run typecheck`, `build` |
| `playwright-core` | 1.64.1 | Drives a real installed Chrome for end-to-end scenes (no bundled browser) | `e2e/harness.ts` |
| `@types/node`, `@types/react`, `@types/react-dom`, `@types/ws`, `@types/qrcode` | see `package.json` | Type definitions only | — |

### Used but not listed in `package.json`

| Package | Comes from | Used for | Where |
| ------- | ---------- | -------- | ----- |
| `@maplibre/maplibre-gl-style-spec` | installed as a dependency of `maplibre-gl` | Validates the custom map style in a test | `test/style.test.ts` |

## Node built-in modules

| Module | Used for | Where |
| ------ | -------- | ----- |
| `node:http` | HTTP server (API routes, static files) | `server/index.ts`, tests |
| `node:fs`, `node:fs/promises`, `node:path` | Serving `dist/`, saving events to disk | `server/index.ts`, `server/persist.ts` |
| `node:crypto` | Random room ids and resume tokens | `server/rooms.ts` |
| `node:test`, `node:assert/strict` | Test runner and assertions | `test/`, `e2e/` |
| `node:child_process`, `node:net`, `node:os`, `node:events`, `node:timers/promises` | Starting the server on a free port and waiting in tests | `test/`, `e2e/harness.ts` |

## Browser APIs (no library)

| API | Feature | Where |
| --- | ------- | ----- |
| Geolocation | Live position | `src/useGeolocation.ts`, `src/startLocation.ts` |
| WebSocket | Connection to the room | `src/useRoom.ts` |
| SpeechRecognition | Talk button (speech to text) | `src/useSpeech.ts` |
| SpeechSynthesis | Spoken announcements | `src/voice.ts` |
| Web Audio | Sound effects | `src/sfx.ts` |
| Notifications + Service Worker | Alerts while the app is in the background | `src/notify.ts`, `public/sw.js` |
| Screen Wake Lock | Keep screen on while sharing | `src/keepAwake.ts` |
| Web Share / Clipboard | "Share link" in the Invite dialog | `src/App.tsx` (`Invite`) |
| localStorage / sessionStorage | Remembered events, profile, settings | `src/safeStorage.ts`, `src/events.ts` |

## Outside services and data

| Service | Used for | Where |
| ------- | -------- | ----- |
| OpenFreeMap (`tiles.openfreemap.org`) | Vector map tiles (OpenMapTiles schema, © OpenStreetMap), map fonts, Natural Earth raster | `src/mapStyle.ts` |
| Mapzen terrain tiles on AWS (`elevation-tiles-prod`) | Hill shading | `src/mapStyle.ts` |
| Google Maps (links only) | "Open in Google Maps" and walking directions, only when tapped | `src/meetup.ts` |
| ElevenLabs sound generation API | Made the MP3s in `public/sfx/` once; not used at runtime | `scripts/gen-sfx.py` (Python standard library only) |
| Render | Hosting | `render.yaml` |
| Tailscale Funnel (optional) | Public demo link | `scripts/demo.sh` |

Fonts are system fonts only (Futura / Georgia stacks in `src/styles.css`); nothing is loaded from a font service.
