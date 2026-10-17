# Meetups: moods, flags, treasure trails, thought bubbles

Branch `feature/meetup-pings`. Written for whoever (person or Claude session) works on this next.

## What it does
- **Mood**: tap Mood, pick hungry, tired, coffee and so on, add a note. Shows as a badge on your pin and on your profile pic. Clears itself after 2 hours.
- **Flags**: tap Flags, then Plant a flag. Tap the map (or use "Where I am"), pick Lunch, Coffee, Drinks, Dinner or Meet up, name the place. Everyone can tap "I'm in".
- **Treasure trails**: each person who is in gets a dotted red trail curving from their pin to the X, dots marching toward it. Tapping Show on a plan previews the trail from you before you commit.
- **Ping**: planting a flag can ping the room. Everyone else gets a toast ("Eric: Lunch at Joe's Tacos?" with I'm in and Show me), a thought bubble over the sender's pin, and a buzz. Speaking it out loud is opt in (Settings).
- **Talk**: tap Talk, speak (or type, the phone keyboard mic works). The words are boiled down on the device into a short bubble ("Eating at Joe's Tacos, join us!"), previewed, then sent. Feeling words ("so hungry") also set your mood. A place name offers "Make it a plan".
- **Crew strip**: names collapse into round profile pics along the top so the map stays clear. Tap a pic to fly to that person. The Names button brings the full list back.

## Events are remembered
- This device keeps a list of the events it is in (`src/events.ts`, localStorage): name, session token, and the profile you joined with. Reopening the app drops you back into your latest event as the same player, no join form. The home screen lists every event you are in, so several can run side by side.
- Events can be named when created (optional). The chip at the top shows the name and head count, and tapping it goes back to the list.
- **Leaving erases the event**: the server drops your pin, your flags and your RSVPs, and this device forgets the event and its token. An event that ended is dropped from the list automatically.
- Closing the app is not leaving. Your pin greys out, your location is forgotten after 5 minutes, and you stay in the event for 3 hours so reopening resumes. Rooms vanish after 3 hours with nobody in them.

## Settings (gear, top right)
Notifications when the app is in the background (asks permission when you join, only used for events you are in), keep my screen on while sharing, speak pings out loud (off by default), and the map legend. Alerts and location only work while the app is open.

## Protocol (shared/protocol.ts)
Client: `mood`, `plan`, `plan_join`, `plan_leave`, `plan_cancel`, `plan_ping`, `bubble`.
Server: `plan`, `plan_gone`, `ping` (never sent back to its creator), `bubble` (sent to everyone including the sender); `welcome` now carries `plans` and `roomName`; `Player.mood`. `POST /api/rooms` takes an optional `{ name }`; `GET /api/rooms/:id` returns the name.
Limits live in `server/rooms.ts` and are all tested: 3 plans per player, 20 per room, one plan per 2 s, a ping per 15 s, a bubble per 3 s, plans live 3 h, bubbles are 60 characters. A leaving player takes their plans with them.

## Where things are
- `src/meetup.ts`: spoken sentence, walking time, curved trail maths. `src/bubble.ts`: what you said to bubble text. `src/treasure.ts`: which trails to draw.
- `src/MapView.tsx` + `src/map-extras.css`: trails, X markers, thought bubbles, mood badges, drop mode.
- `src/Crew.tsx` (strip and toasts), `src/Meetups.tsx` (mood, plans, flag form, talk), wired in `src/App.tsx`.
- Tests: `test/meetups.test.ts`, `test/meetup.test.ts`, `test/bubble.test.ts`, `test/treasure.test.ts`, browser tests in `e2e/` (`npm run e2e`).

## Honest limits
- Everything is passive and only while the app is open. A locked or closed phone gets nothing and sends nothing: web apps cannot track location in the background, and closed-app push needs stored subscriptions. Keep-screen-on helps while the app is open.
- Trails are drawn as the crow flies (curved for looks), not along streets. Sending locations to a routing service would break the privacy promise, so a real route would be opt in.
- Speech recognition in Chrome sends audio to Google's service unless the browser processes it on device. The UI always offers typing.

## Heads up for the other session
This touches `shared/protocol.ts`, `server/rooms.ts`, `server/index.ts`, `src/App.tsx` and `src/styles.css`. Please say before changing those so we do not collide.
