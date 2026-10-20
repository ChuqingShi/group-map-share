# Components: everything a user can see or tap in the webapp. 

Terms: 
* *sheet* slides up from the bottom of the map (one at a time, chosen by `panel` in `RoomPage`); 
* *popup* sits in the middle and dims the page; 
* *toggle* switches in place.

Notes:
* <sup>*</sup> organizer only: once anyone in the event ticks "I'm an organizer", only organizers see it. While nobody is an organizer, everyone sees it.

## 1. Start page (`Landing` in `src/App.tsx`)

| On screen | What it does | Technical name | File |
| --------- | ------------ | --------- | ---- |
| **On page** | | | |
| Title and tagline | "Groupz", "See where your crew is, live…" | `Landing` | `src/App.tsx` |
| Your events | Events this device is in; tap to reopen | `events-list`, `event-card` | `src/App.tsx`, `src/events.ts` |
| 1-2-3 steps | Shown when you have no events yet | `.steps` | `src/App.tsx` |
| Name your event box | Optional event name | `event-name` | `src/App.tsx` |
| 🎮 Create a room | Creates the event, goes to the Map | `create` in `Landing` | `src/App.tsx` |
| Fine print | Privacy note | `.fineprint` | `src/App.tsx`, `src/styles.css` |
| **Pop up** | | | |
| Welcome back | Takes you back into your latest event | `Message`, `consumeAutoResume` | `src/App.tsx` |
| First mission popup | Once per new deploy, over any page | `QuestIntro`, `shouldShowIntro` | `src/Quest.tsx`, `src/quest.ts` |

## 2. Join page (`JoinScreen` in `src/App.tsx`)

| On screen | What it does | Technical name | File |
| --------- | ------------ | --------- | ---- |
| **On page** | | | |
| Character circle | Tap to shuffle avatar and color | `join-avatar` | `src/App.tsx` |
| Event name and tagline | "Choose a name and avatar to join your crew." | `JoinScreen` | `src/App.tsx` |
| Your name box | Name, or "Joining as … change" | `JoinScreen` | `src/App.tsx` |
| 🎨 Pick a different character | Avatar picker and color swatches | `.customize`, `AVATARS`, `COLORS` | `src/App.tsx`, `shared/protocol.ts` |
| ⭐ I'm an organizer | If anyone is, only organizers plant flags or rename | `join-organizer` | `src/App.tsx` |
| 📍 Join & share my location | Joins, goes to the Map | `JoinScreen` | `src/App.tsx` |
| Fine print | Privacy note | `.fineprint` | `src/App.tsx` |

## 3. Map (`RoomPage` in `src/App.tsx`)

| On screen | What it does | Technical name | File |
| --------- | ------------ | --------- | ---- |
| **Top bar** | | | |
| Event name chip | Back to the Start page's "Your events" | `btn-events`, `onExit` | `src/App.tsx` |
| 🔭 Show everyone | Fits everyone on the map | `fitAll` | `src/MapView.tsx` |
| ➕ Invite | Invite popup with QR code; also opens after creating a room | `btn-invite`, `Invite` | `src/App.tsx` |
| ⚙️ Settings | Settings sheet | `btn-settings`, `SettingsSheet` (`panel === 'settings'`) | `src/Meetups.tsx` |
| ↳ Rename row<sup>*</sup> (top, no heading) | Text field already filled with the current event name, plus a **Rename** button. Non-organizers see a sentence instead: "⭐ *name*: only organizers can rename this event." | `RenameEvent` (`event-rename-input`, `btn-event-rename`, `rename-locked`) | `src/Meetups.tsx` |
| ↳ ⭐ I'm an organizer | Switch organizer on or off | `btn-organizer` | `src/Meetups.tsx` |
| ↳ 🔔 Allow notifications | Big button, only shown before the browser has been asked | `btn-allow-notifications` | `src/Meetups.tsx`, `src/notify.ts` |
| ↳ 🔔 Notify me when the app is in the background | Switch alerts on or off | `btn-notify` | `src/Meetups.tsx`, `src/notify.ts` |
| ↳ Keep my screen on | Switch the wake lock | `btn-awake` | `src/Meetups.tsx`, `src/keepAwake.ts` |
| ↳ Speak pings out loud | Switch spoken announcements | `btn-voice` | `src/Meetups.tsx`, `src/voice.ts` |
| ↳ Sound effects | Switch sounds | `btn-sfx` | `src/Meetups.tsx`, `src/sfx.ts` |
| ↳ 🗺️ Show the map legend | What the map colors mean | `btn-legend`, `Legend` | `src/Meetups.tsx`, `src/App.tsx` |
| ↳ ⏳ Replay the first mission | First mission checklist | `btn-quest-replay`, `QuestPanel` (`panel === 'quest'`) | `src/Meetups.tsx`, `src/Quest.tsx` |
| ↳ Leave this event | Tap twice, then "You left the room" | `btn-leave`, `leaveTap` | `src/Meetups.tsx`, `src/App.tsx` |
| ↳ Fine print | "Alerts and location only work while the app is open…" | `.fineprint` in `SettingsSheet` | `src/Meetups.tsx` |
| **Crew strip** | | | |
| Someone's picture | Opens their card | `CrewStrip` → `PersonCard` (`panel === 'card'`) | `src/Crew.tsx`, `src/PersonCard.tsx` |
| **On the map** | | | |
| Your own pin | Your card, editable | `onPinClick` → `PersonCard` | `src/MapView.tsx`, `src/PersonCard.tsx` |
| Someone else's pin | Their card | `onPinClick` → `PersonCard` | `src/MapView.tsx`, `src/PersonCard.tsx` |
| A flag (X) | Flags sheet on that flag | `onPlanClick` → `PlansPanel` (`panel === 'plans'`) | `src/MapView.tsx`, `src/Meetups.tsx` |
| A restaurant, cafe or bar | Place card: distance, Google Maps, 🚩 Plant a flag here<sup>*</sup> | `onPlaceTap` → `PlaceCard` (`panel === 'place'`) | `src/MapView.tsx`, `src/PlaceCard.tsx` |
| Thought bubbles | What people said with Talk; not clickable | `bubbles` | `src/MapView.tsx`, `src/bubble.ts` |
| **Toolbar** | | | |
| Mood | Mood sheet | `btn-mood`, `MoodSheet` (`panel === 'mood'`) | `src/Meetups.tsx` |
| Flags (tap) | Flags sheet titled "Plans", newest flag first | `FlagButton` → `PlansPanel` (`panel === 'plans'`) | `src/FlagDrag.tsx`, `src/Meetups.tsx` |
| ↳ 🚩 Plant a flag<sup>*</sup> | Top of the sheet: start a new flag. Non-organizers see "only organizers plant flags. You can still say I'm in." | `btn-new-plan`, `organizers-only` | `src/Meetups.tsx` |
| ↳ Plan lunch?<sup>*</sup> | Link shown when someone's mood is hungry | `onNew` | `src/Meetups.tsx` |
| ↳ Flag card | One per flag: place, who made it, how many going, distance, note, suggestions, faces of who's going | `plan-card` | `src/Meetups.tsx` |
| ↳↳ I'm in | On a flag you haven't joined yet | `btn-plan-join` | `src/Meetups.tsx` |
| ↳↳ Not going | On someone else's flag you joined | `btn-plan-leave` | `src/Meetups.tsx` |
| ↳↳ No thanks | On someone else's flag you haven't declined | `btn-plan-decline` | `src/Meetups.tsx` |
| ↳↳ 💡 Suggest | On someone else's flag; opens the "How about…?" sheet to suggest another place | `btn-plan-suggest` → `SuggestSheet` (`panel === 'suggest'`) | `src/Meetups.tsx` |
| ↳↳ 🗺️ Show | Preview the trail from you to the flag on the map | `btn-plan-show` | `src/Meetups.tsx` |
| ↳↳ 📍 Google Maps | Opens the place in Google Maps | `link-plan-maps`, `mapsLink` | `src/Meetups.tsx`, `src/meetup.ts` |
| ↳↳ 🚶 Directions | Walking directions in Google Maps | `link-plan-directions`, `directionsLink` | `src/Meetups.tsx`, `src/meetup.ts` |
| ↳↳ 🔔 Ping | Your own flag only: ping the crew again | `btn-plan-ping` | `src/Meetups.tsx` |
| ↳↳ Cancel | Your own flag only: tap, then "Sure?" to remove it | `btn-plan-cancel` | `src/Meetups.tsx` |
| ↳↳ Plan it<sup>*</sup> | Your own flag only, next to someone's suggestion: start a new flag at that place | `btn-plan-adopt` | `src/Meetups.tsx` |
| Flags (drag)<sup>*</sup> | Plant a flag where you drop it, then the flag form | `FlagButton` → `DropBanner`, `PlanForm` | `src/FlagDrag.tsx`, `src/Meetups.tsx` |
| Talk | Talk sheet: speak or type; turning what you said into a flag<sup>*</sup> | `btn-talk`, `TalkSheet` (`panel === 'talk'`) | `src/Meetups.tsx`, `src/useSpeech.ts` |
| Names | Toggle: list of everyone; tap a name for their card | `btn-names`, `namesOpen`, `PlayerRow` | `src/App.tsx` |
| Pause / Share | Toggle: stop or restart sending your location | `btn-share`, `sharing` | `src/App.tsx` |
| **Pop up** | | | |
| Toasts | Joins, flags, bubbles; flag toasts have I'm in, No thanks, 💡 Suggest (opens "How about…?"), Show me, 📍 Google Maps | `Toasts` | `src/Crew.tsx` |
| First mission chip | ⏳ progress chip; tap for the checklist | `QuestChip` → `QuestPanel` | `src/Quest.tsx` |
| Location warning | Location blocked or unavailable | `GeoBanner` | `src/App.tsx` |

## 4. End page (`Gone`, `Message` in `src/App.tsx`)

| On screen | What it does | Technical name | File |
| --------- | ------------ | --------- | ---- |
| **Pages** | | | |
| Room not found | Event ended or link is wrong | `Gone` | `src/App.tsx` |
| You left the room | After Leave this event | `Message` | `src/App.tsx` |
| Opened somewhere else | Event opened in another tab or window | `Message` | `src/App.tsx` |
| Room is full | Player limit reached | `Message` | `src/App.tsx` |
| **Shared layout** | | | |
| Explanation text | The paragraph under the title | `.tagline` in `Message` | `src/App.tsx`, `src/styles.css` |
| Back to start | Returns to the Start page | `onExit` | `src/App.tsx` |

## 5. Across pages

| On screen | What it does | Technical name | File |
| --------- | ------------ | --------- | ---- |
| Hint text in empty boxes | Grey example text like "e.g. Sam" | `input::placeholder` | `src/styles.css` |
| Fine print | Small notes on several pages and sheets | `.fineprint` | `src/styles.css` |
