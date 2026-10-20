# Testing

| Command | What it runs |
| --- | --- |
| `npm test` | Unit and server tests in `test/` (`node --test`, no browser). |
| `npm run typecheck` | `tsc` over `src`, `server`, `shared`, `test`. |
| `npm run typecheck:e2e` | `tsc` over `e2e/` (Node only strips types, so this is what catches type errors there). |
| `npm run e2e` | Builds the app, then runs `e2e/*.e2e.ts` in a real browser, one file at a time. |
| `npm run check` | `typecheck`, `typecheck:e2e`, `test`, `e2e`: everything CI runs. |

Run one file or one scenario while working (after one `npm run build`):

```bash
node --test e2e/plans.e2e.ts
node --test --test-name-pattern="^4\." e2e/plans.e2e.ts
```

## How the e2e suite works

- `e2e/harness.ts` starts the production server (`NODE_ENV=production node server/index.ts`, serving `dist/`) on a free
  port, drives the Google Chrome that is already installed (`chromium.launch({ channel: 'chrome' })`, nothing is
  downloaded) and gives each person their own isolated phone-sized context (390x844).
- `?sim=LAT,LNG` makes GPS deterministic. `speechSynthesis` is replaced by a recorder (`window.__spoken`) and
  `webkitSpeechRecognition` answers with whatever a test puts in `window.__transcript`.
- Tests are `node:test` plus the Playwright API (no Playwright runner), selecting only on `[data-testid=...]` plus the few
  hooks in the selector contract (`.map[data-paths]`, `.pin[data-player-id]`, and so on).
- Waits are on the DOM and on websocket messages. Map tiles are never waited for, and requests to every non-local host
  are aborted so runs are fast and work offline. `E2E_ALLOW_NET=1` lets tiles through.
- Console and page errors are collected per person; failed requests to external map hosts are ignored.
- Contexts, browser and server are always closed. When a scenario fails, `e2e/artifacts/` (gitignored) gets a screenshot,
  the console log, the websocket message types and the server log for each person.

| File | Scenarios |
| --- | --- |
| `smoke.e2e.ts` | 1 create, join, one avatar, no errors. 2 two people, leaving. |
| `mood.e2e.ts` | 3 mood on pin and avatar, clearing. |
| `plans.e2e.ts` | 4 plan, ping, join from the toast, trails. 5 voice is passive until switched on in settings. |
| `talk.e2e.ts` | 6 typed and spoken words become a bubble. 6b "make it a plan". |
| `resilience.e2e.ts` | 7a ping rate limit. 7b reload keeps the plan. 7c hostile websocket input. |
| `phone.e2e.ts` | 8 small phone (360x640): no sideways scroll, buttons on screen. |
| `settings.e2e.ts` | 10 settings window toggles. |
| `events.e2e.ts` | 9a to 9e remembered events (reload, new page, leave, two events, server restart). 11 closing a page keeps the player. |

Environment: `E2E_CHANNEL` (e.g. `chromium`, `msedge`), `E2E_EXECUTABLE_PATH`, `E2E_HEADED=1`, `E2E_ALLOW_NET=1`,
`E2E_ROOT` (another checkout that has `dist/`). If Google Chrome is missing the harness tries Chromium, Edge and
Brave at their usual paths, and says which browser it used.

## Limits to know about

- Headless Chrome renders WebGL in software (`--enable-unsafe-swiftshader`), so the map is slow but works. Screenshots
  show the map without tiles unless `E2E_ALLOW_NET=1`.
- Geolocation is granted and set on the context, but the app is driven by `?sim`; the real `watchPosition` path is not covered.
- Real speech recognition and speech synthesis are not exercised, only the app's use of them.
- Wake lock and Notification delivery cannot be observed in headless Chrome; the settings scenario only checks the toggles.
- Server restarts (scenario 9e) keep the same port, so the browser keeps its remembered events.

## CI

Once enabled, the workflow runs on push and pull request with Node 24: `npm ci`, typecheck, `npm test`, `npm run build`,
then a second job runs `npm run e2e` on the runner's preinstalled Google Chrome (it installs Chrome with
`npx playwright-core install chrome --with-deps` only if the image lacks it) and uploads `e2e/artifacts/` when it fails.
Alternative without Chrome: `npx playwright-core install chromium --with-deps` and `E2E_CHANNEL=chromium`.

The workflow file is saved as `docs/ci/ci.yml`, not under `.github/`, because the GitHub token it was pushed with lacks the
`workflow` scope. To switch CI on: `gh auth refresh -s workflow`, move it to `.github/workflows/ci.yml`, push.
