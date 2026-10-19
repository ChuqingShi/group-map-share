# TODO (Oct 19)

Sections follow what a user sees, in order. The name in brackets is what that page is called in `src/App.tsx`.

1. **Start page** (`Landing`): create a room, or reopen one of "Your events"
2. **Join page** (`JoinScreen`): name, avatar, color, organizer
3. **Map** (`RoomPage`): everyone live on the map
   - Invite popup (`Invite`): QR code, opens on its own after creating a room
   - Sheets (in `src/Meetups.tsx`): moods, flags, Talk, settings
4. **End page** (`Gone`, `Message`): room not found, you left, opened elsewhere, room full. "Back to start" returns to the Start page

## 1. Start page (`Landing`)

- [x] Left-align the fine print (`.fineprint` in `src/styles.css`)
- [ ] Shorten the privacy fine print in `Landing` (`src/App.tsx`), e.g. "Your location is shared only while the app is open and never saved. Leave and you're erased. Empty events vanish after 3 hours."

## 2. Join page (`JoinScreen`)

- [x] New avatar and color lists (`shared/protocol.ts`)
- [x] Fix the join tagline (stray quote, trailing space)
- [ ] Check that returning players saved with 🐵 or `#ffb020` get a sensible new avatar/color (the server only accepts values in the lists)

## 3. Map (`RoomPage`)

### 3.1 Invite popup (`Invite`)

- [ ]

### 3.2 Sheets (moods, flags, Talk, settings)

- [ ]

## 4. End page (`Gone`, `Message`)

- [ ] Left-align the body text: add a `message-body` class to the `<p>` in `Message` plus `.message-body { text-align: left; }`. Also affects "Welcome back", "You left the room", "Opened somewhere else", "Room is full"
- [ ] If the 3-hour idle time (`idleMs` in `server/rooms.ts`) ever changes, update the "3 hours" text in `Gone`, the landing fine print and the README

## 5. Across pages

- [x] Lighter placeholder text everywhere (`input::placeholder` in `src/styles.css`)
- [ ] Check the other `.fineprint` spots still look right left-aligned: join page (`App.tsx`), test mission (`Quest.tsx`), mood and settings sheets (`Meetups.tsx`), own card (`PersonCard.tsx`). If not, scope the rule to `.landing-card .fineprint`

## 6. Tooling

- [ ] Use Node 24 locally to match `engines` in `package.json` (currently on Node 25), so `npm install` stops rewriting `package-lock.json`
- [ ] Add the `.node-version` file the README and `render.yaml` mention (it does not exist yet)
- [ ] Turn on CI: run `gh auth refresh -s workflow`, then move `docs/ci/ci.yml` to `.github/workflows/ci.yml`
- [ ] Add `@maplibre/maplibre-gl-style-spec` to devDependencies (`test/style.test.ts` imports it, but it only arrives through `maplibre-gl`)
- [ ] Optional: run dev with `GMS_DATA_DIR=.data` (and ignore `.data/`) so rooms survive `node --watch` restarts

## 7. Maybe later

- [ ] Give each page its own browser tab title (`document.title`); today every page is "Groupz"
- [ ] Consider a router only if the app grows past a few pages (today just the Start page and the room pages)

## Done

- [x] Write a file index (`docs/FILE_INDEX.md`)
- [x] Write a tech stack list (`docs/TECH_STACK.md`)
