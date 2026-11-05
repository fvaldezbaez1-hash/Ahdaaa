# AA Macro — a self-learning macro for Anime Adventures (Roblox)

AA Macro plays Anime Adventures for you, and it **learns each map by itself**
instead of relying on hard-coded click positions:

- **Learns maps:** On a new map it works out three things:
  - **Where units can go:** it sweeps the cursor with a unit selected and reads the green/red placement preview.
  - **Where enemies walk, and which end is the spawn:** it watches them move.
  - **How far each unit reaches:** it measures the range ring.

  From that it builds several layouts.
- **Gets better over time:** Every run is scored. The best layout gets used more, the others are still tried now and then, and spots the game refuses are remembered and avoided. It also learns what each placement and upgrade costs, so it waits for the money instead of spamming clicks.
- **Places and upgrades units** in the order you set:
  - damage units go where they cover the most path
  - farm units stay out of the way and are upgraded early
  - support units go next to your damage units
- **Moves itself:**
  - replays walks you record in the lobby and in matches, respawning first so every walk starts from the same spot
  - zooms the camera out at the start of each match
  - rotates the camera back to the saved view of the map
- **Reads cards** on any "pick one" screen and chooses the best one by your settings:
  - Summer Hunt weather (Low Tide / Rising Tide / Tsunami)
  - portal blessings and curses
  - dungeon rooms and relics

  It reads card text such as "+50% enemy health", so new cards are scored too.
- **Finds buttons by their words, not pixels:** "Replay", "Vote", "Return to Lobby" and so on. It keeps working at any window size and after small UI changes. If an update renames a button, fix the word in Settings.
- **Handles the whole run:** lobby → match → results, with replay, next stage or back to the lobby. It also handles reconnects, popups and stuck screens, keeps win/loss stats and can send optional Discord reports.

It only **reads the screen and presses keys/clicks**, like a person. It never
touches Roblox's memory or runs scripts inside the game.

> ⚠️ Roblox's rules don't allow automation, and any macro can get an account
> flagged. Use it at your own risk.

---

## Download

When this is merged into `main`, the apps are published here:

- **Windows:** https://github.com/fvaldezbaez1-hash/Ahdaaa/releases/download/aa-macro/AAMacro-Windows.zip
- **Mac (Apple Silicon):** https://github.com/fvaldezbaez1-hash/Ahdaaa/releases/download/aa-macro/AAMacro-Mac.zip

Before that, every build is on the repo's **Actions** tab. Open the latest
"AA Macro" run and download `AAMacro-Windows` or `AAMacro-Mac` from
*Artifacts*. You need to be signed in to GitHub.

**Windows:** unzip, open the `AA Macro` folder, run `AA Macro.exe`. If
SmartScreen warns you, click *More info → Run anyway*. The app isn't signed.

**Mac:**
1. Unzip, then right-click `AA Macro.app` → **Open** → **Open**.
2. In **System Settings → Privacy & Security**, allow AA Macro under all three:
   - **Screen Recording**, so it can see the game
   - **Accessibility**, so it can click and type
   - **Input Monitoring**, for the F1/F2/F3 hotkeys
3. Restart the app after allowing them.

## First-time setup (about 10 minutes)

1. **Open Roblox → Anime Adventures in a window** (not fullscreen) and
   stay in the lobby.
2. **Tools tab:**
   - Press **Resize now**. The default game area is 1280×720.
   - Press **Read the screen**. The Run tab's log should list the words it sees. If it sees nothing, check the Mac permissions above.
   - Under *Screen areas*, **Pick** the **Map area**: drag over the map, leaving out the hotbar and side menus. This step matters, because it's where units are allowed to go.
3. **Team tab:** for each hotbar slot set:
   - **Role:** dps, farm, support, or skip
   - **Copies:** the unit's placement cap
   - **Upgrade to:** 99 means max
   - **Priority:** 1 goes first
4. **Tasks tab:**
   - **Map name:** e.g. `Namek Infinite`. It learns one map per name, so use a different name for each map.
   - **Mode**, **Runs** (0 = forever), and **After each match**: replay, next or lobby.
   - **Lobby steps:** how to get from the lobby into the match. The easy way is **Teach**: press it, click through the menus in Roblox until the match starts, then press *Stop teaching*. It writes the steps using the words you clicked. You can also type them:
     ```
     click "Play"
     click "Story"
     click "Planet Namak"
     click "Act 6"
     click "Hard"
     click "Start"
     ```
   - If you have to walk somewhere, record a walk in **Tools → Walking routes** and add `walk <name>` to the steps.
5. **Cards tab:**
   - Move **Greed** toward *Safe* (weaken enemies) or *Greedy* (harder cards, bigger rewards).
   - Add cards you always or never want, and your dungeon room and relic order.
   - With a card screen open in Roblox, **Test on the current screen** shows the score of each card.
6. **Settings tab:** check the keys. The defaults are slots 1–6, **R** upgrade, **X** sell, **O** zoom out, and arrow keys to rotate.
7. Go back to the lobby and press **F1** (or **Start**). **F2** pauses, **F3** stops.
   You can also slam the mouse into the **top-left corner** of the screen to stop it in an emergency.

The **first run on a new map** spends about a minute learning:
1. It scans where units can go.
2. It watches the first enemies.
3. It builds its layouts.

Later runs reuse what it learned. **Maps → View what it learned** shows the
path (red = spawn, yellow = your base), the placeable ground (green) and its
chosen unit spots. **Tools → Run the learning demo** shows the same thing on a
simulated map without Roblox.

## Lobby step commands

| Command | What it does |
|---|---|
| `click "Text" [seconds]` | wait for the text to appear (default 8 s), then click it |
| `optional click "Text"` | click it if it shows up within 2 s, otherwise carry on (popups) |
| `click_at 0.50 0.62` | click a spot given as fractions of the window |
| `click_template name` | click an image saved in Tools → Image templates |
| `walk name` | replay a recorded walk (respawns first, checks the arrival text) |
| `key e` / `hold w 1.5` | press a key / hold it for 1.5 s |
| `wait 2` / `wait_for "Vote" 20` | wait 2 s / wait up to 20 s for some text |
| `scroll -5` / `reset` | scroll the wheel / respawn the character |

**Leave steps** in a task run when *Leave at wave* is reached, for example to
leave an Infinite run at wave 50: `click "Settings"`, `click "Leave"`.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Could not find a window called Roblox" | Open Roblox first. On Mac, allow Screen Recording. |
| It doesn't recognise a screen | **Tools → Read the screen** and look at the words it sees. Add the right word under **Settings → Words**. |
| Units never get placed | Check the slot keys, and that the **Map area** covers the map. Try **Tools → Placement preview colours** to teach it the game's green/red. |
| Upgrades don't happen | Check the **Upgrade unit** key. It reads your yen to confirm each upgrade. If yen isn't found, pick the **Yen counter** area in Tools. |
| It picked a bad layout | It improves with every run. To start a map over, use **Maps → Relearn**. |
| Wrong card picks | Use **Cards → Test on the current screen** to see the scores, then add the card to *Always pick* or *Never pick*. |

Logs are in the data folder shown at the bottom of the app (`logs/aamacro.log`).

## What has been tested

The vision, card reading, map learning, placement, upgrades and the full
lobby → match → cards → results → replay loop are covered by automated
tests. They run against a **simulated** tower-defense game with real
OCR, on Windows, macOS and Linux in CI.

It has **not yet been run against the live game**. Expect some
first-run tuning: button words, keys and the map area may need adjusting.
The settings exist for exactly that.

## Run from source (developers)

```bash
cd aa-macro
python -m pip install -r requirements-dev.txt
python -m pytest -q              # tests
python -m aamacro                # open the app
python -m aamacro --selftest     # check OCR / OS access
python build_app.py              # build the app into dist/
```

Code map: `aamacro/vision` (OCR, screen states, placement preview),
`aamacro/cards` (card reading and scoring), `aamacro/maps` (path learning,
placement scan, spot optimizer, per-map memory), `aamacro/movement` (walks,
camera), `aamacro/game` (lobby steps, units, the bot loop), `aamacro/ui`
(the app), `aamacro/platform` (Windows / macOS input and capture),
`aamacro/sim.py` (the simulated game used by tests and the demo).
