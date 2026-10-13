# Video Room

A WebXR app for PCVR (tested with PSVR2 via SteamVR OpenXR). You stand in a box room where
every wall, the floor and the ceiling are grids of screens, each playing a video. Built with
Three.js and Vite, no engine install needed.

## Running

Double-click `start.bat`. It installs dependencies on first run, starts Vite on
http://localhost:5173 and opens the page in Chrome (or Edge). WebXR needs a Chromium
browser and the `localhost` URL (not the LAN IP). SteamVR must be running and set as the
active OpenXR runtime before clicking **Enter VR**.

The panel shows diagnostics at the bottom: browser, secure context, `navigator.xr`
presence and whether an `immersive-vr` session is supported.

## Files

- `index.html` – control panel (room size, grid, videos, help) and the canvas.
- `main.js` – everything else: scene, tiles, video handling, library, controls, focus, locomotion.
- `start.bat` – launcher.
- `vite.config.js` – dev server on port 5173, host enabled.

## Panel

| Section | What it does |
|---|---|
| Room size | W / D / H in metres. "Focus screen fills N° of view" sets the floating screen size. "Dim others" darkens the wall while a screen is focused. |
| Screens per surface | Starting grid (cols × rows) for walls and for floor/ceiling. Optional bezels. **Apply layout** rebuilds everything and resets per-wall grids and room scale. |
| Videos | **Add folder…** adds a folder to the library (File System Access API); each folder row has a **subfolders** checkbox (on by default) and an × to remove it. **Add files…** adds one or more individual videos as a row. Rows persist across launches in IndexedDB; after a restart a row says "click to reopen" until you click it to re-grant read access. **Shuffle** redeals from the combined pool; **Clear** removes every row. "Use sample video" shows the sample until the next shuffle or layout change. Also: "Start each video at a random point", "Auto-jump every N s", "Separate decoder per screen" (stress test for non-library mode), "Mute all". |
| Stats | render fps, decoder count, audible count, dropped video frames %, stalled/paused. |

## Controls

Point a Sense controller at a screen; it gets a blue border and an info strip along its
bottom edge (progress bar, name, time, speaker icon, pause mark, grid buttons).

**Tap (pointing at a screen)**

| Button | Action |
|---|---|
| Trigger | swap to a random unused library video |
| Grip (short) | solo audio on this screen (everything else muted) |
| Grip (hold ≥ ½ s) | add this screen's audio to what's playing |
| A / X | pause / play |
| B / Y | focus: lift the screen off the wall into a big floating panel; again to send it back |
| Stick click | jump to a random point in the timeline |
| Strip buttons | − / + columns and rows for **that wall only** (other walls keep playing) |

**Drag (press on one screen, release on another)**

| Button | Action |
|---|---|
| Trigger | swap the two screens' videos |
| Grip | copy the video to the target (shares the decoder, stays in sync) |

**Stick**

| Hold | Stick | Action |
|---|---|---|
| nothing, pointing at a screen | ◀ ▶ | scrub (speed follows deflection) |
| nothing | ▲ ▼ | room bigger / smaller, scaled around where you stand |
| Grip | any | walk (head-relative) |
| Grip + Trigger | ▲ ▼ | fly up / down |
| Trigger | ◀ ▶ | turn in place |
| Grip | stick click | back to room centre, floor level |

Once the stick moves while grip or trigger is held, that press is movement only and will
not swap / copy / toggle audio on release.

**Desktop (no headset)**: drag = look, WASD = walk, Q/E = down/up, click = random swap,
right-click = audio (shift = add), wheel or ◀ ▶ = scrub, space = pause, M = audio,
F = focus, R = random jump, X,X = swap places, C,C = copy, + / − = room size.

## How it works (for future changes)

- **Tiles**: `tiles[]` of `{ mesh, w, h, video, label, highlight, surface }`. `grids[key]` holds
  cols/rows per surface; `buildSurface()` builds one surface, `changeGrid()` rebuilds one
  surface without touching the others.
- **Videos**: one `<video>` element per distinct source, `VideoTexture` on a
  `MeshBasicMaterial`. Copies share the element (and so the decoder). All start muted;
  audio is enabled per element. `setTileSource()` disposes old material/texture only if no
  other tile still uses it.
- **Library**: `roots[]` is the list of sources (`kind` 'dir' or 'files', handle(s), `sub` flag,
  `granted`, `entries`). `scanRoot()` walks a root (recursively if `sub`), `rebuildLibrary()`
  flattens granted roots into `library[]`. Each entry's `key` is `<rootId>:<relative path>`, used
  as `tile.label` so same-named files in different folders stay distinct; `tileName()` gives the
  filename for display. Object URLs are created lazily in `urlFor()` and survive rescans.
  `persistRoots()` stores handles in IndexedDB; the legacy single `folder` key is migrated.
- **Focus**: `floatGroup` (unit plane scaled to size) animates from the tile's world pose to
  a pose in front of the head. `floatTile` is a pseudo-tile with `isFloat` + `origin`, so all
  per-tile actions work on it. Size = `focusSize(dist, aspect)`, distance = `focusDistance()`.
- **Viewer rig**: `rig` group contains the camera and both controllers. Walking/flying move
  it, turning rotates it around the head. `clampRig()` keeps the head inside the room.
- **Room scale**: `roomGroup.scale` + `roomGroup.position`, scaled about the head so the
  floor stays at y=0 and walls recede evenly. `commitRoomScale()` bakes the live scale into
  the W/D/H fields on stick release.
- **Strip**: single `CanvasTexture` strip mesh re-parented to the focused tile's surface
  group. Strip is in the raycast target list; `stripButtonAt(uv)` maps hits to buttons.
- **Gamepad mapping** (WebXR standard): 0 trigger, 1 grip, 3 stick click, 4 A/X, 5 B/Y,
  axes 2/3 thumbstick.

## Performance notes

- Decoders, not screens, are the cost. RTX 5090 (4× NVDEC) handles 20+ 1080p streams
  easily; 4K per tile costs ~4× each. Check chrome://gpu says video decode is hardware
  accelerated, and chrome://media-internals shows `D3D11VideoDecoder`.
- Audio is the thing that hurt: each unmuted element adds an audio pipeline and forces
  A/V sync. Keep most screens muted (the default) and solo one or two.
- Seeking is instant on MP4 with the index at the front (faststart); MKV/MOV can hitch.
- Visibility-based decoder pausing was discussed and rejected: with a 110° FOV you can
  only ever pause ~1 wall, and resume/seek hitches on head turns.

## Ideas not yet built

- Spatial audio (Web Audio panner so sound comes from the screen's wall).
- Preload the next swap candidate to hide the ~200 ms black frame.
- Fixed physical strip height so grid buttons stay usable on 8×8 walls.
- Save/restore layouts (grids, room size, which video where).
- Per-screen cropping of a mosaic video (many clips in one decoder).
- Native build (Unity/Godot OpenXR) if WebXR limits are hit.
