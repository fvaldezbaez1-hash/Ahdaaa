# Forge – fitness & food tracker

A private, all-in-one fitness app for your phone that combines:

- **A workout logger like Hevy/Strong**
- **A food diary like MyFitnessPal**
- **Smart calorie targets like MacroFactor**

It installs from a web link onto your home screen (iPhone and Android) and
works offline. There's no account, no ads and no subscription, and your data
stays on your phone.

**App link:** https://fvaldezbaez1-hash.github.io/Ahdaaa/ (live once GitHub Pages is switched on; see [Publishing](#publishing-one-time-setup)).

## Put it on your phone

**iPhone:** open the link in **Safari** → tap **Share** → **Add to Home Screen** → **Add**.

**Android:** open the link in **Chrome** → tap **⋮** → **Install app**.

From then on, open Forge from its home-screen icon. The browser tab and the
installed app keep separate data, so stick to the icon.

## What's inside

**Workouts**
- Log sets fast: last time's numbers sit next to each set, and tapping ✓ fills in the suggestion.
- Rest timer starts automatically, with a chime/vibration, ±15 s, and per-exercise rest times.
- Double-progression coaching: each lift has a rep range, and Forge tells you when to add a rep and when to add weight.
- Warm-up, drop and failure sets, optional RPE, supersets, notes, reordering, exercise swaps.
- ~130 exercises with muscles, equipment and form cues; create your own.
- Ready-made programs: Full Body Beginner, Push/Pull/Legs, Upper/Lower, 5×5, Dumbbells at Home, No Equipment.
- Personal records (heaviest, estimated 1RM, set volume, reps, time, distance), a rep-max table and a per-exercise progress chart.
- History with editing, a plate calculator, and the screen kept awake during workouts.
- Import your history from **Hevy** or **Strong** (CSV) and export in Hevy's format.

**Food**
- Diary by meal, with calories-left ring and protein/carbs/fat bars.
- Barcode scanner (works on iPhone too, even offline) and food search via [Open Food Facts](https://world.openfoodfacts.org).
- ~100 built-in common foods (USDA), so basics work without internet.
- Quick add, custom foods from a nutrition label, favorites, recents, saved meals, copy yesterday, water tracking.

**Smart targets (MacroFactor-style)**
- Smoothed weight trend that ignores daily water swings.
- Weekly check-in: compares what you ate with how your weight trended over the last 4 weeks, estimates what you really burn, and resets your calorie and macro targets for your goal (lose, maintain or gain at a chosen rate).
- Starts from a formula estimate (Mifflin-St Jeor × activity) and moves toward your real numbers as data comes in. Each check-in can move it at most 300 kcal, so one odd week can't swing your targets.
- Or set your own targets manually.

**Progress**
- Weight chart, measurements and progress photos with side-by-side compare.
- Training: workouts per week vs goal, weekly volume, consistency calendar, sets per muscle, recent PRs.
- Nutrition: daily calories vs target, average macros, expenditure history.

**Your data**
- Everything is stored on the phone (IndexedDB).
- Save a backup file (share to Files/Drive/email) and restore it on any phone.
- CSV exports of workouts, food and body data.

## Limits of a home-screen app

- It can't read Apple Health or Google Health Connect, so watch workouts and steps don't sync in.
- Food search needs a connection; barcode scanning also needs one the first time it sees a product.
- On iPhone, the rest-timer chime only plays while the app is open.

## Development

```bash
cd fitness
npm install
npm run dev        # local dev server
npm test           # unit tests (Vitest)
npm run lint       # oxlint
npm run build      # typecheck + production build to dist/
```

Stack: React 19 + TypeScript + Vite, Dexie (IndexedDB), vite-plugin-pwa
(offline service worker), and `barcode-detector` (a ZXing WebAssembly fallback
for phones without a built-in barcode reader). Charts are hand-rolled SVG.

Code map:

| Folder | What's there |
|---|---|
| `src/lib/` | Data model, database, and the logic: strength math, progression, weight trend, expenditure/targets, CSV import/export, Open Food Facts, backups. Unit tested. |
| `src/data/` | Exercise library, program templates, built-in foods |
| `src/workout/` | Workout tab, live logger, routines, history, exercise pages |
| `src/food/` | Food diary, add-food search, barcode scanner, food forms |
| `src/progress/`, `src/today/`, `src/settings/` | The other screens |
| `src/ui/` | Shared components, charts, icons |

## Publishing (one-time setup)

The `Forge fitness app` GitHub Actions workflow tests and builds the app on
every push. On the `main` branch, the `Publish apps to GitHub Pages` workflow
publishes it (together with [Lumen](../photo/README.md) under `/photo/`).
GitHub needs Pages switched on once:

1. In the repository on GitHub, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, pick **GitHub Actions**.
3. Run the **Publish apps to GitHub Pages** workflow (Actions tab → the
   workflow → **Run workflow** on `main`), or push any change to `fitness/`.

The app is then live at `https://fvaldezbaez1-hash.github.io/Ahdaaa/`. Updates
download in the background and apply the next time the app is opened fresh.
