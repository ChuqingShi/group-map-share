# Plan: a 7-step test mission for first-time users

## Context
The test mission (`STEPS` in `src/quest.ts`) is meant for someone opening Groupz for the first time, but its order doesn't match how people start using the app. It opens with "Set your mood", includes "close and reopen" (a check for developers), and one hint is out of date ("Leave in the toolbar"; Leave is now in Settings, and the toolbar has Pause). The new mission follows the path a complete beginner takes, from creating a room to leaving it, and covers as much of the app as possible.

## How a step ticks off today (the mechanism we reuse)

```
something happens in RoomPage (src/App.tsx)
  → quest.done('<id>')                       src/Quest.tsx:36  (useQuest)
  → ignored unless the mission was started   (prev.started), and only the first time
  → markDone() adds the id                   src/quest.ts
  → saveQuest() writes localStorage "gms-quest" → chip "⏳ n/7" and checklist re-render
```

Two kinds of checks call `quest.done`:
- **Event checks**: called inside a handler when the user does something (`talk` in the Talk sheet's send, `leave` in `leaveTap`).
- **State checks**: a `useEffect` that looks at room state (`flag`: "a plan of mine exists").

**A gap in state checks today:** their effects only re-run when the room state changes, not when the mission starts. Someone who starts the mission after already doing a step (e.g. already on the map, then Settings → Replay) never gets it ticked. Fix: add `quest.state` to those effects' dependencies so they re-check when the mission starts or restarts. That's safe: `done()` returns the same state when a step is already ticked, so it can't loop.

## The 7 steps, and the code that checks each one

| # | id | Title | Hint | Kind | Check (all in `RoomPage`, `src/App.tsx`) |
|---|---|---|---|---|---|
| 1 | `setup` | 🎮 Get on the map | Create a room and allow location. | state | `live && meP?.pos` |
| 2 | `profile` | ⭐ Edit your profile | Tap your picture → change your name → Save.<br>Then ⚙️ → I'm an organizer. | state | `nameChanged && meP?.organizer` |
| 3 | `invite` | 📲 Invite a friend | ➕ Invite → a friend scans the QR code. | state | `players.length >= 2` |
| 4 | `talk` | 🎙 Say how you feel | Talk → say "I'm starving, let's have some tacos" → Send. | event | existing `quest.done('talk')` in the TalkSheet `onSend`/`onPlant` (≈ lines 731, 738) |
| 5 | `flag` | 🚩 Plant a flag | Hold Flags, drag it onto the map → Plant it. | state | existing: `plans.some((p) => p.by === room.me)` |
| 6 | `imin` | 🔔 Get an "I'm in" | Your friend taps I'm in on your flag. | state | `plans.some((p) => p.by === room.me && p.joined.some((id) => id !== room.me))` |
| 7 | `leave` | 🚪 Leave the event | ⚙️ → Leave this event → tap again. | event | existing `quest.done('leave')` in `leaveTap`, after `room.leave()` succeeds |

### Step 1: how "location allowed" is checked
The chain from the browser's permission prompt to the server:
```
browser asks "Allow location?" → user allows
  → useGeolocation (src/useGeolocation.ts): watchPosition success → geo.fix
  → App.tsx:292  if (live && sharing && geo.fix) room.send({ t: 'pos', ... })
  → server/rooms.ts:229 updatePosition → player.pos = { lat, lng, acc, at }
  → broadcast { t: 'player' } back to me → meP.pos is set
```
The check is **`meP?.pos` (the server's copy), not `geo.fix` or the browser's Permissions API**, because:
- it proves the whole chain works: permission granted, GPS gave a fix, the socket sent it, the server accepted it. That's what "set up" really means;
- the Permissions API isn't reliable for geolocation on iPhone Safari, while `meP.pos` works everywhere;
- `live` plus `meP` also proves step 1's other half: the room exists and you joined with a name and avatar (the server only adds you after `hello`).

Cases:
- **Denied:** `geo.error === 'denied'`, no fix, `pos` stays null → not ticked; `GeoBanner` (App.tsx:891) tells the user.
- **Pause sharing later:** the server clears `pos` (`rooms.ts:254`), but the step stays ticked. Ticks are permanent.
- **`?sim` (tests):** a fake fix goes through the same chain, so tests exercise everything after the permission prompt.

### Step 2: two actions, in either order
- New `const [nameChanged, setNameChanged] = useState(false)` in `RoomPage`; `saveMyCard` calls `setNameChanged(true)` when the saved name differs from `meP.name`.
- The state-check effect ticks `profile` when `nameChanged && meP?.organizer`. Because both are in its dependencies, the same check covers "name first, then organizer" and "organizer first, then name". (As built, this is state rather than the ref first planned, so no extra call in `saveMyCard` is needed.)
- Limits: `nameChanged` lives only in this page session, so a reload between the two halves means changing the name again. Ticking the join form's organizer box counts as the organizer half.

### Steps 3, 5, 6: room state
- **3:** `players` (App.tsx:316) holds everyone in the room, including me, so `>= 2` means someone else is here.
- **5:** unchanged. Any flag of mine counts, whether dragged or planted from the list.
- **6:** a flag's `joined` list starts with its creator (`rooms.ts:418`, `joined: [id]`), so we look for **someone other than me** in it. This replaces today's `imin` check ("I joined a friend's flag"), which can't work once I'm the only organizer.

### Removed checks
- `mood` effect (`if (meP?.mood) quest.done('mood')`).
- `reopen` effect and its `resumedAtMount` ref (only used there).
- The mood **sound** effect next to them stays untouched.

## File changes
1. **`src/quest.ts`**: new `STEP_IDS = ['setup', 'profile', 'invite', 'talk', 'flag', 'imin', 'leave']` and `STEPS` from the table. Old saved ids (`mood`, `reopen`) are dropped on load by the existing `isStep` filter.
2. **`src/App.tsx`**: the check changes above, all in the "Test mission" block (≈ lines 324–342) plus `saveMyCard`.
3. **`src/Quest.tsx`**: intro text "Six quick things to try" → "Seven quick things to try". The chip, checklist and results email read `STEPS`.
4. **`test/quest.test.ts`**, **`e2e/settings.e2e.ts`**: see below.
5. **Docs, only where needed:** `docs/TESTING.md` (10b wording, new 10c, scenario counts), `README.md` (34 → 35 scenes), `docs/TODO.md` (ticked line with the PR). These lines are also edited on the unmerged `chore/post-hackathon-cleanup` branch, so they're updated there after this merges, to avoid merge conflicts.

## How the tests are designed

### Unit: `test/quest.test.ts` (pure logic, no browser)
- Update fixtures to the new ids and titles (e.g. `markDone(s, 'flag')`, `resultsText` expects `[x] Get on the map` and `[ ] Leave the event`).
- **New test: old progress is cleaned up.** Saved state `{ done: ['mood', 'reopen', 'talk'] }` loads as `['talk']`. Protects people who started the old mission from a broken count after the deploy.
- The existing "7 steps, each with icon/title/hint" and "ticked once, any order" tests keep working unchanged.

### e2e: the checks above live in React effects, so they're tested in a real browser
Automated browsers never see the intro popup (`shouldShowIntro`), so every scenario starts the mission from **Settings → 🧪 Replay**. Assertions read the checklist (`[data-testid="quest-step"][data-step="…"][data-done="true"]`) or the chip text (`n/7`).

**10b (update, in `e2e/settings.e2e.ts`)**: the chip is on screen above the toolbar (unchanged) and reads **`1/7`** right after Replay, because `setup` is already true. This guards the "re-check when the mission starts" fix.

**10c (new, same file): the full mission walkthrough with Breeca and Eric.** Each line is one step, in mission order:
1. Breeca joins with `?sim` and starts the mission → `setup` ticked (`1/7`).
2. Breeca switches on `btn-organizer` → still `1/7`, because step 2 needs both halves. Then Breeca changes the name on the card (`crew-avatar` → `card-name-input` → `btn-card-save`, as in scenario 15b) → `profile` ticked (`2/7`).
3. Eric joins Breeca's room → `invite` (`3/7`).
4. Breeca types "I'm starving, let's get tacos" in Talk (`talk-input` → `btn-talk-send`) → `talk` (`4/7`).
5. Breeca plants a flag (`createPlan` helper) → `flag` (`5/7`). Dragging is already covered by scenario 12.
6. Eric taps `btn-plan-join` on Breeca's flag → `imin` (`6/7`).
7. Breeca leaves (`leaveRoom` helper) → the page shows "You left the room", so the test reads localStorage `gms-quest` (`page.evaluate`) and expects all 7 ids → **mission complete**.

What 10c protects: every step's check fires on the action its hint describes, in the suggested order, including the two-part step 2 and the flipped step 6. It reuses existing harness helpers (`openSettings`, `setToggle`, `createPlan`, `leaveRoom`, `eventually`); no harness changes.

**Not covered by tests (stated in `docs/TESTING.md` already):** the real browser permission prompt, because `?sim` skips `watchPosition`. I'll check it on a phone instead (below).

## Git, and saving this plan (done first)
1. New worktree and branch from the latest `main` (`580cdce`): **`fix/redo-test-mission`** in `Oct17/group-map-share-redo-quest`. The chore checkout and its uncommitted `TODO.md` edit stay untouched.
2. Save this plan in the repo as **`docs/FIRST_MISSION_PLAN.md`** (same UPPERCASE naming as the other docs), and add one row for it to the `docs/` table in `docs/FILE_INDEX.md`.
3. Then the code and test changes above. Commit, push and open a PR as before (only when you say so).
Suggested commit: `fix(quest): redo the test mission as seven first-time-user steps`

## Verification
1. `npm run check`: typecheck, unit tests, and all e2e scenarios including updated 10b and new 10c.
2. Run 10c against the old code first to confirm it fails, then with the change to see it pass.
3. After merge and deploy, on a phone, using `?quest` to force the popup: tap Start, create a room, **allow location in the real prompt**, and check that `setup` ticks. Then a quick pass through the rest with a second phone.
