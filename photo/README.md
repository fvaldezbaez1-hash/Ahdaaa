# Lumen – photo editor

A professional photo editor that runs on your own device. You can develop RAW
files from more than 1,000 cameras, edit with pro tools on your GPU, finish
with 100 hand-made presets, and export at full resolution. It works on iPhone,
iPad, Android, Mac and Windows. There's no account and no upload: your photos
stay on your device.

**App link:** https://fvaldezbaez1-hash.github.io/Ahdaaa/photo/ (live once GitHub Pages is switched on; see [Publishing](#publishing-one-time-setup)).

## Install it

**iPhone / iPad:** open the link in **Safari**, tap **Share**, then **Add to Home Screen**, then **Add**.

**Android:** open the link in **Chrome**, tap **⋮**, then **Install app**.

**Mac / Windows:** open the link in Chrome or Edge and click the install icon
in the address bar. It also works in any modern browser tab.

Once it's installed, Lumen works offline.

## What's inside

**Import and library**
- RAW from 1,000+ cameras (Canon, Nikon, Sony, Fujifilm, Leica, Panasonic,
  Olympus/OM, Pentax, DNG and more), plus JPEG, PNG, HEIC and TIFF.
- Star ratings, pick/reject flags, albums, filters and sorting, multi-select.
- Copy and paste edits between photos, or apply a preset to a whole selection.
- Back up and restore all your edits as a single file.

**Editor**
- **White balance:** in Kelvin and tint for RAW (computed from the camera's own
  color matrices), presets and a click-on-gray eyedropper.
- **Light:** exposure, contrast, highlights, shadows, whites and blacks. An
  edge-aware tone engine recovers highlights and lifts shadows without halos.
- **Presence:** texture, clarity, dehaze, vibrance and saturation.
- **Tone curve:** point curves for luminance and for each RGB channel.
- **Color mixer:** hue, saturation and luminance for 8 color bands, plus a
  black-and-white mix.
- **Color grading:** shadows, midtones, highlights and global, with blending and balance.
- **Detail:** sharpening (radius, detail, masking) and luminance and color noise reduction.
- **Effects:** vignette and film grain.
- **Crop and straighten:** aspect presets, a level tool, rotate and flip.
- Seven profiles (Lumen Color, Neutral, Vivid, Portrait, Landscape and more).
- Before/after (press and hold, split view, or before only), clipping warnings, a live
  histogram, unlimited undo and true 100 % zoom from the full-resolution file.
- Keyboard shortcuts on desktop (listed in Settings).

**Presets**
- 100 hand-made looks in 20 collections, such as Film, Portrait, Landscape,
  Black & White, Cinematic, Moody and Wedding.
- An Amount slider from 0 to 200 %. Looks add to your own settings, so your
  edits are kept.
- "Best for this photo" suggestions, picked on your device from the light,
  color and subject of the photo.
- Favorites, your own presets, and import and export of Lightroom `.xmp` presets.

**Export**
- JPEG (MozJPEG), PNG or 16-bit TIFF, in sRGB or Display P3, with metadata.
- Resize on export. It renders in tiles, so full-size exports work even on phones.
- Save to Files or Downloads, or share straight to other apps.

**Coming next:** a built-in AI editing assistant. You pick OpenAI, Google or
Anthropic and use your own API key. The settings for it are already in place.

## Good to know

- **iPhone and iPad:** the Photos picker hands browsers a JPEG copy, never the
  RAW. To edit RAW files, save them to the **Files** app and import from
  there. RAW decoding needs a lot of memory. Where the device can't develop a
  RAW, Lumen opens the camera's built-in JPEG preview and says so.
- **Storage:** photos and edits are kept in the browser's storage on the
  device. Use **Settings → Back up edits** now and then. Safari can clear
  storage for sites you haven't opened in a while, unless Lumen is added to
  the home screen.
- Lumen needs WebGL2, which every current browser has.

## For developers

```bash
cd photo
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run lint       # oxlint
npm run build      # typecheck + production build into dist/
```

The stack is React 19, TypeScript and Vite. Rendering uses WebGL2 with a
float pipeline. RAW decoding uses LibRaw compiled to WebAssembly
(`libraw-wasm`) in a worker. JPEG encoding uses MozJPEG (`@jsquash/jpeg`).
Storage uses Dexie (IndexedDB), and `vite-plugin-pwa` adds offline support.

Edits are never baked into pixels. Each photo keeps an edit recipe
(`src/edit/types.ts`), and the engine renders it on demand: on screen, for
thumbnails and for export. Edits are stored as layers from the start, so
local adjustments can be added later.

Code map:

| Folder | What's there |
|---|---|
| `src/color/` | Color science: matrices, Kelvin/tint white balance, OKLab, curves. Unit tested. |
| `src/edit/` | The edit recipe, slider ranges and defaults |
| `src/engine/` | WebGL2 render engine: pipeline stages, shaders, tiled export, histogram, auto settings |
| `src/io/` | Decoding (LibRaw, images, TIFF), import, IndexedDB storage, thumbnails, export encoders (JPEG/PNG/TIFF, EXIF, ICC) |
| `src/library/` | Library grid, albums, import and export sheets |
| `src/editor/` | Editor screen: panels, stage, crop tool, desktop and phone layouts, shortcuts |
| `src/presets/` | The 100 looks, how they apply, the presets panel and screen, Lightroom `.xmp` |
| `src/assistant/` | AI assistant (in progress) |
| `src/settings/`, `src/state/`, `src/ui/` | Settings, shared state, shared components |

`scripts/*/check.mjs` are end-to-end checks that drive the real app in
headless Chromium with real photos and RAW files. Each script has its usage
at the top.

## Publishing (one-time setup)

The `Lumen photo editor` workflow tests and builds the app on every push. On
the `main` branch, the `Publish apps to GitHub Pages` workflow publishes it
next to [Forge](../fitness/README.md). GitHub needs Pages switched on once:

1. In the repository on GitHub, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, pick **GitHub Actions**.
3. Run the **Publish apps to GitHub Pages** workflow (Actions tab → the
   workflow → **Run workflow** on `main`), or push any change to `photo/`.

Lumen is then live at `https://fvaldezbaez1-hash.github.io/Ahdaaa/photo/`.
