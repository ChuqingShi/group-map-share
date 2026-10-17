# Group Map Share

Live location sharing for a group, with no accounts, no phone numbers and no app to install.
Everyone shows up as a game-style pin on a shared map, says how they feel, and plants flags
("lunch here?") that the crew can say yes, no thanks or "how about somewhere else" to.

**Try it live:** <https://erics-macbook-air.tailf559e5.ts.net:8443/>
(served from Eric's laptop while the demo is on, so it may be offline. Anyone with a room's QR code or
link can join; starting an event needs the host link.)

1. Someone taps **Create a room** and gets a QR code (and a share link).
2. Everyone who scans it taps **Join** (new people type a name; their character is already picked).
   That one tap also asks for location, so the map opens where you are.
3. Everyone appears on the map, live. Tap a picture, a name or a pin for their card.

The map is a custom "game board" style over free OpenStreetMap vector tiles. Water, sand/beach,
grassland, parks, forest, farmland, wetland, town and buildings each get a bold colour and a
small pattern (waves, sand dots, grass tufts, trees), plus hillshading. Open Settings for the legend.
The interface is dressed like a retro game manual (cream paper, square corners, double frames).

<img src="docs/screenshot.png" width="320" alt="Two players on the beach in Santa Monica">

## What you can do

- **Join in one tap.** A returning device does not even type its name. The device remembers the events it is in:
  close the app, reopen it, and you are back in the same event as the same player. The home screen lists your
  events. **Leave** (Settings, tapped twice) erases you on the server and on the device.
- **Moods.** Tap a common one (hungry, tired, need coffee...) or type your own with any emoji, or none.
  It shows on your picture and pin. What you say with **Talk** sets your mood too.
- **Flags.** Press and **drag the 🚩 button onto the map** and let go: a card opens already filled in (if a
  restaurant or bar is under the flag it names itself and picks lunch, coffee or drinks). One tap plants it
  and pings the crew. Everyone who says **I'm in** gets a dotted treasure trail from their pin to the X.
- **Say no thanks, or suggest something else.** Every invitation can be declined, or answered with another
  place. The person who made the flag sees the ideas and can plan one with a tap.
- **Talk.** The big round button opens listening. Say "let's go eat at Joe's Tacos": a short thought bubble
  shows over your pin, your mood follows what you said, and if Joe's Tacos is on the map nearby the flag is
  planted and the crew pinged, after a three second window to cancel. Typing works too.
- **Cards.** Tap anyone's picture, name or pin: their mood, the contact info they chose to share (a phone
  number or email becomes tap to call or email), and the flags they made or joined.
- **Organizers.** Tick "I'm an organizer" when you join (or in Settings). While anyone in the event is
  one, only organizers can plant flags; with none, everyone can. Everyone can still say I'm in, no thanks
  or suggest.
- **Test mission.** A new build shows a short checklist that ticks itself off as a tester tries each feature.
- **Settings.** Rename the event (anyone, unless there is an organizer), an Allow notifications button (the
  browser's own pop-up), sound effects, keep the screen on, spoken pings (off by default), the map legend, the
  organizer switch, the test mission and Leave. Your own card lets you change your name and contact line.
- **Sounds.** Soft cozy chimes for joining, pings, bubbles and flags, generated with ElevenLabs
  (`scripts/gen-sfx.py`, key read from the macOS Keychain). Switch them off in Settings.

## Run it

Needs Node 24 (it runs the TypeScript server directly with Node's type stripping).

```bash
npm install
npm run dev        # Vite on http://localhost:5173, realtime server on :8787 (proxied)
```

Production-style, one process serving the built app and the WebSocket on one port:

```bash
npm run build
npm start          # http://localhost:8787
```

| Env var              | Default   | Meaning                                                                                  |
| -------------------- | --------- | ---------------------------------------------------------------------------------------- |
| `GMS_PORT`           | `8787`    | Port for the HTTP/WebSocket server                                                       |
| `GMS_HOST`           | `0.0.0.0` | Interface to listen on                                                                   |
| `GMS_HOST_KEY`       | unset     | When set, only a browser that opened `/?host=<key>` once can start events. Joining stays open to anyone with a room link |
| `GMS_TRUSTED_HOPS`   | `1`       | How many proxies in front of the server append to `X-Forwarded-For`                      |
| `GMS_ALLOWED_ORIGINS`| unset     | Extra hosts or URLs allowed to open WebSockets (the page's own host is always allowed)   |
| `GMS_BUILD`          | git sha / `RENDER_GIT_COMMIT` | Build id; a new one shows testers the test mission again           |

These are deliberately not `PORT`/`HOST`, which dev machines often already use for something else.
`PORT` is only honoured on Render (see below).

### Demo launcher

`scripts/demo.sh` builds, starts the server with a host key (kept in the gitignored `.demo-host-key`) and prints
the links. `--public` also opens a Tailscale Funnel link on port 8443, `--stop` closes everything. Delete
`.demo-host-key` afterwards to rotate the key.

## Deploy on Render

`render.yaml` is a Render Blueprint for a single free-plan Node web service:
build `npm ci && npm run build`, start `npm start`, health check `/api/health`, Node pinned via `NODE_VERSION`.

- When `RENDER` is set (Render always sets it), the server listens on Render's `PORT` and trusts
  `X-Forwarded-For` (the entry written by the last proxy) for per-address limits. Locally, `PORT` is ignored.
- Set `GMS_HOST_KEY` in the Render dashboard if you do not want strangers to be able to start events,
  and `GMS_TRUSTED_HOPS` if more than one proxy sits in front.
- The client builds its WebSocket URL (`wss://` on https) and the QR/share link from the page's own origin,
  so they work on the public `onrender.com` URL with no configuration.
- Rooms live in memory: keep one instance. On the free plan the service sleeps when idle, and a
  restart or redeploy ends all rooms (people just create a new one).

### Testing without walking around

Add `?sim` to any URL to replace GPS with a fake position that wanders around Santa Monica beach,
or `?sim=LAT,LNG` to start somewhere specific. Open two browser windows (or one normal and one
private window) on the same room link to see two players. `?quest` forces the test mission,
`?noquest` hides it.

```bash
npm run typecheck
npm test           # room logic, security, summarizer, place lookup, events, and real WebSocket sessions
npm run e2e        # builds, then drives two phone-sized Chromes through 29 scenes (about two minutes)
npm run check      # all three
```

The browser suite uses the Google Chrome already installed (no browser download). See `docs/TESTING.md`.

### Phones need HTTPS

Browsers only allow geolocation on secure origins. `localhost` counts, but a phone hitting
`http://192.168.x.x:5173` does not. To try it on a phone, put it behind HTTPS (a reverse proxy,
a tunnel such as Tailscale, or your platform's TLS). On an iPhone, add the page to the Home Screen to
get notifications and a full-screen launch.

## How it works

```
src/            React front end (Vite)
  App.tsx         landing and events list, one-tap join, the room (HUD, toolbar, sheets, toasts)
  MapView.tsx     MapLibre map: pins, thought bubbles, flags, treasure trails, drop mode
  Crew.tsx        the round profile pics along the top, and the toasts
  Meetups.tsx     mood, flags, talk, suggest and settings sheets
  PersonCard.tsx  a person's card: mood, contact, flags
  FlagDrag.tsx    the draggable flag button
  places.ts       find a named place among the map's loaded points of interest
  bubble.ts       boils what you said into a thought bubble, a mood and maybe a flag (on device)
  events.ts       the events this device is in (localStorage)
  useRoom.ts      WebSocket client with auto-reconnect and resume
  quest.ts        the test mission
  mapStyle.ts     the game-board map style + terrain patterns (also feeds the legend)
server/
  index.ts        HTTP API, static file serving, WebSocket relay
  rooms.ts        in-memory rooms: join/rejoin, positions, moods, flags, organizers, expiry
  security.ts     host key, origin check, address limits, flood limits, headers
shared/protocol.ts  message types shared by both sides
e2e/            real-browser scenes (playwright-core + node:test)
docs/MEETUPS.md the design note for the meetup features
```

- `POST /api/rooms` creates a room with a random 128-bit id (and an optional name). The link *is* the key,
  so treat it like a private invite.
- Clients connect to `/ws?room=<id>`, send `hello` (name, avatar, colour) and then `pos` updates
  from `navigator.geolocation.watchPosition`. The server relays each update to the room.
- A session token (kept with the remembered event) lets a reload or a dropped connection resume the same
  player, their flags and their answers. A player whose connection drops is shown greyed out, their
  location is forgotten after 5 minutes, and they are removed after 3 hours.

## Privacy

- Nothing is written to disk on the server. Rooms, positions, moods, flags and contact lines live only in
  server memory and are gone on restart.
- Location is sent only after you tap **Join & share my location**, and only while the app is open. Close the app
  and the server forgets your location after 5 minutes. **Pause sharing** hides your pin and makes the server
  forget your last position at once. **Leave** removes you, your flags, your answers and your card entirely.
- Rooms are deleted after 3 hours with nobody connected.
- On your own device the app remembers: your events and their session tokens, your name, character and contact
  line, your recent typed moods, your sound and alert choices, and the area you were last in (rounded to about
  1 km, only to open the map in the right place). Leaving an event erases that event from the device.
- Contact lines are shown only to people in the same event, as plain text. Names, places, moods, notes and
  contact lines are rendered with `textContent`, never as HTML, and capped in length.
- Talk uses your browser's speech service (Chrome may send the audio to Google). Typing always works, and
  turning what you said into a bubble, a mood and a flag happens on your device. Nothing you say is sent to an AI service.
- Notifications are local to the device and only while the app is open in the background.
- Pages send `no-referrer`, so room ids don't leak to the tile servers.

## Security

Rooms are protected by their unguessable link. For running on the public internet there is more:
an optional host key for starting events; WebSockets from other sites are refused; per-address and
total connection limits; a message flood limit; a timeout for sockets that never join; limits on how many
new people one address can add to a room; ghost joiners are dropped quickly; request and frame limits;
security headers; and a last-resort handler so one bad request cannot take every live event down.
Several crash bugs (malformed URLs, `//`, bad WebSocket frames) were found by review and are covered by tests.

## Limits

- Alerts and location only work while the app is open. Web apps cannot track location in the background;
  keep-screen-on helps while the app is open.
- Treasure trails are curves from you to the flag, not street routes (a routing service would see everyone's location).
- Organizer status is self declared: anyone with the link can tick the box.

## Map data

Vector tiles: [OpenFreeMap](https://openfreemap.org) (OpenMapTiles schema, © OpenStreetMap contributors).
Hillshade: Mapzen/AWS Terrain Tiles. Low-zoom relief: Natural Earth. None need an API key.
