# TODO (Oct 20)

What we noticed while using the app, in the order a user goes through it. One short line per observation; how to fix it is worked out later. Name in brackets = what it is called in the code (see `docs/COMPONENTS.md`).

## 1. Start page (`Landing`)

- [x] Small print was centered and hard to read (PR #3).
- [ ] Privacy small print is too long.
- [ ] Test mission popup shows up for everyone on first open. Should real users see it?

## 2. Join page (`JoinScreen`)

- [x] Wanted more avatars and colors (PR #3).
- [x] Line under the title had a stray quote mark (PR #3).
- [ ] Not checked yet: what returning players see if their avatar or color was removed (🐵, old orange).

## 3. Map (`RoomPage`)

### Invite popup (`Invite`)

- [ ]

### Top bar and Settings (`SettingsSheet`)

- [ ] Notification feature not checked yet.

### Toolbar: Mood, Flags, Talk, Names, Pause

- [x] Mood sound kept repeating after setting a mood (PR #4).
- [x] "Drag me onto the map" hint over Flags was unclear and cluttered the toolbar (PR #6).

### Tapping pins, places and flags on the map

- [ ]

### Things that pop up by themselves (toasts, test mission chip)

- [x] Test mission chip never showed up; it sat above the top of the screen (PR #5).

### Leaving

- [ ] Wording is currently verbose and unclear.

## 4. End page (`Gone`, `Message`)

- [ ] Explanation text is centered and hard to read.
- [ ] "3 hours" is typed by hand here; it must change if the server's limit ever changes.

## 5. Across pages

- [x] Grey hint text in empty boxes was too bold (PR #3).
- [ ] Not checked yet: small print on other pages after left-aligning it.

## 6. Behind the scenes

- [ ] Local Node version (25) doesn't match the project's (24).
- [ ] Automatic checks on GitHub (CI) are not switched on.
- [ ] One test relies on a library that isn't listed in `package.json`.
- [ ] Test events disappear every time the dev server restarts.

## Maybe later

- [ ] Every page has the same browser tab title.
