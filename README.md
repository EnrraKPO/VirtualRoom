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
| Room | **Shape**: Box (W × D × H); **Prism** with N walls (3–48), sized by the width across flats and H; or a **polyhedron** (tetrahedron, octahedron, dodecahedron, icosahedron, 80-face geodesic sphere, or an N-trapezohedron with 2N kite faces, N = 3–16, odd N for a flat ceiling) standing on one face, sized by the width across (twice the floor face's inradius; height follows). A prism's walls get the normal wall grid, its N-gon floor and ceiling carry the largest square grid that fits. A polyhedron's faces are each one screen showing the video centre-cropped to the face shape; "Split each face" (level 1–4) cuts triangles into L² screens and pentagons into a fan of 5 × (L−1)². **Max crop** caps how much of the video's width or height may be cut off (0 = never crop, 100 = always cover the face); **Fill the rest with** blank (the screen is clipped to the video, the dark face shows around it) mirrored video (kaleidoscope-style repeats, with a subtle dark line on every seam where a reflection starts), or **nested copies**: smaller in-sync copies of the same video fitted into the leftover areas, each cropped a bit more per nesting level (depth 1–4, +N % per level); leftovers too small (copy narrower than 12 cm or 20 % of the main video) or too slim (bounding box more than 4:1) get the chosen fallback, mirrored or blank. Both apply live. Rectangular screens use the same fit, so videos are cropped rather than stretched. "Focus screen fills N° of view" sets the floating screen size. "Dim others" darkens the wall while a screen is focused. **Turning**: smooth (speed follows stick deflection) or snap (15° per stick flick), for both turning and tilting. **Transitions**: normal / quick / slow / off, remembered. A new video on a screen pops in: once it has a frame, a copy of the screen showing it grows from the centre over the old video, which keeps playing until covered. When a surface's grid or split level changes, the old screens stay behind and each new screen is unveiled in place by a sector sweeping clockwise about the surface centre, from one edge of the screen to the other (a screen containing the centre gets a full clock wipe); the video is already in position, only the window onto it grows. |
| Screens per surface | Starting grid (cols × rows) for walls and for floor/ceiling. Optional bezels. **Apply layout** rebuilds everything and resets per-wall grids and room scale. |
| Videos | **Add folder…** adds a folder to the library (File System Access API); each folder row has a **subfolders** checkbox (on by default) and an × to remove it. **Add files…** adds one or more individual videos as a row. Rows persist across launches in IndexedDB; after a restart a row says "click to reopen" until you click it to re-grant read access. **Shuffle** redeals from the combined pool; **Clear** removes every row. "Use sample video" shows the sample until the next shuffle or layout change. Also: "Start each video at a random point", "Auto-jump every N s", "Separate decoder per screen" (stress test for non-library mode), "Mute all". |
| Likes & dealing | ♥ on a screen's panel likes its video; the list persists (file handles in IndexedDB, matched to the library by folder name + path, so it survives restarts and re-scans). **Deal**: all videos / liked first, then the rest / liked only (repeats) — used by Apply layout, Shuffle, adding folders and startup, and remembered. **Export likes** saves the list as JSON; **Clear likes** empties it. |
| Stats | render fps, decoder count, audible count, dropped video frames %, stalled/paused. |

## Controls

Point a Sense controller at a screen: its contour lights up as the progress bar (bright blue
for the played part, clockwise from the top-left corner), a sound icon floats in front of its
top-right corner (green = audible, grey with a red cross = muted, pause bars when paused), and
a small button panel sits in its bottom-right corner: grid or split level with − / + buttons for
that surface, then zoom − / + and reset (↺) for that one screen (the current zoom is shown, with a
* when the screen has its own adjustment), then ♥ to like / unlike the video on it. Liked screens
show a small heart on their floating icon.
Icon and panel keep a constant apparent size whatever the distance; the panel shrinks only when
the tile cannot hold it, and slides inward on triangles and kites. Screens that are audible show
the sound icon even when not pointed at.

**Tap (pointing at a screen)**

| Button | Action |
|---|---|
| Trigger | swap to a random unused library video |
| Grip (short) | solo audio on this screen (everything else muted) |
| Grip (hold ≥ ½ s) | add this screen's audio to what's playing |
| A / X | pause / play |
| B / Y | focus: lift the screen off the wall into a big floating panel; again to send it back |
| Stick click | jump to a random point in the timeline |
| Panel buttons | − / + columns and rows for **that wall only** (other walls keep playing); on a polyhedron face − / + change its split level. Zoom − / + (×1.25 per press) and ↺ reset apply to **that screen only** |

**Station board**: a small table that follows you at waist height, just below the straight-ahead
view (look down to see it; faint until you look at it or point at it). Drag its ♥ "deploy" slot onto
any screen to put a random liked video there.

**Drag (press on one screen, release on another)**

| Button | Action |
|---|---|
| Trigger | swap the two screens' videos |
| Grip | copy the video to the target (shares the decoder, stays in sync) |

**Drag inside the same screen** (press, move the beam, release on the same screen)

| Button | Action |
|---|---|
| Trigger | pan the video inside the screen (it follows the beam) |
| Grip | zoom: beam up = in, down = out, centred on the screen |
| Stick click while trigger-dragging | reset that screen to the crop setting |

On the **focus screen** the same drags move it (trigger: the grabbed point follows the beam, the
screen keeps facing you) and scale it (grip: beam up = bigger, 0.3–12 m wide); stick click while
trigger-dragging puts it back to its default pose. The focus screen always draws on top of the room.

A screen you have adjusted keeps its own zoom and offset (the crop setting no longer applies to
it) until you reset it or rebuild its surface. Leaving the screen mid-drag reverts the adjustment
and the drag becomes a normal swap / copy.

**Stick**

| Hold | Stick | Action |
|---|---|---|
| nothing, pointing at a screen | ◀ ▶ | scrub (speed follows deflection) |
| nothing | ▲ ▼ | room bigger / smaller, scaled around where you stand |
| Grip | any | walk (head-relative) |
| Grip + Trigger | ▲ ▼ | fly up / down |
| Trigger | ◀ ▶ | turn in place |
| Trigger | ▲ ▼ | tilt the room about you (the wall ahead rolls up over you); any orientation is reachable by combining |
| Grip | stick click | back to room centre, floor level, room levelled |

Once the stick moves while grip or trigger is held, that press is movement only and will
not swap / copy / toggle audio on release.

**Desktop (no headset)**: drag = look, WASD = walk, Q/E = down/up, click = random swap,
right-click = audio (shift = add), wheel or ◀ ▶ = scrub, space = pause, M = audio,
F = focus, R = random jump, X,X = swap places, C,C = copy, + / − = room size.

## How it works (for future changes)

- **Shapes**: `shape` is `'box'`, `'prism'` (N walls) or a polyhedron key. `surfaces()` returns the
  face list for the current shape; prism walls are keyed `wall0..`, polyhedron faces `face0..` with
  `kind: 'face'`, a local 2D polygon `pts` and a `quat`. `wallPlanes()` gives walls/faces as outward
  normals + distances from the room centre `(0, polyCentreY, 0)` and drives both `clampRig()` (sloped
  faces push the head back horizontally) and `focusDistance()`.
- **Fill regions**: `fitTile()` ends with a list of regions `{ poly, cx, cy, vw, vh }` (polygon + the video
  rectangle it maps to) merged by `regionsGeometry()` into the tile mesh. Blank = the clipped main region;
  mirror = the whole face mapped to the main rectangle (texture wraps mirrored); nested = main region plus
  `nestFill()` recursing through `leftoverPieces()` (≤ 4 convex pieces per rectangle). `updateSeams()` draws
  seam lines for every mirrored region.
- **Likes**: `likes[]` of `{ handle, rootName, rel, name }` persisted under the `likes` key; `likedKeys` is
  the set of library keys currently liked (rebuilt by `rebuildLikedKeys()` on library or like changes).
  `makeDealer(exclude)` yields entries per the Deal setting; `deployLiked(tile)` picks a random available
  liked video. The station board (`board` group, `updateBoard()` each frame) is a world-space group
  repositioned from the head pose with a lazily following yaw; its `deploySlot` mesh is a raycast target
  in VR and starts a drag of kind `'liked'` whose release on a tile calls `deployLiked`.
- **Transitions**: `setTileSource()` / `swapPlaces()` / `copyTo()` never put the new material on the mesh
  directly; they call `enterWith(tile, video, mat, finish, enter)`, which waits for the video to have a frame
  (`loadeddata`) and then runs the entrance: `popIn` (overlay mesh with the new fit, scaled 0 → 1 over the
  old video) or `wipeIn(pivot)` (used by `changeGrid`: `tile.wipe = { pivot, a1, span, e }` makes
  `applyTileGeometry()` clip every fill region with `clipSector()`; `sectorOf()` gives the screen's angular
  span seen from the surface centre). `cancelTransition()` applies the final state at once, so anything that
  touches a tile's material first cancels. Old videos/materials go through `retire()`, which checks tiles,
  pending transitions and ghosts before killing/disposing. `changeGrid` keeps the previous surface group as a
  ghost (translated 4 mm back, new backing and hit meshes hidden) until every new tile's transition is done.
  `disposeVideos()` drops all ghosts and transitions first.
- **Per-screen view**: `tile.view = { zoom, dx, dy }` (null = follow the crop setting). `zoom` is relative to the
  inscribed video size (1 = whole video visible, `fit.coverRatio` = face covered, max 2× that); `dx/dy` are
  offsets in video widths/heights. `adjustDrag()` edits it live during an in-screen drag; `resetView()` clears it.
- **Polyhedra**: `polyhedron(kind, across, n)` builds vertices (`polyVertices`; the trapezohedron is two apexes
  plus a zigzag ring, apex height solved so kites are planar and all vertices share one sphere), takes the convex hull by
  brute force (`hullFaces`, fine for ≤ 42 vertices), rotates face 0 down to be the floor, scales so the
  floor's inradius is `across / 2`, and returns per-face centroid, quaternion (local z = inward normal,
  local y = up along the face) and counter-clockwise polygon. `splitPolygon()` subdivides; `buildFaceTiles()`
  makes one `ShapeGeometry` tile per piece with `tile.poly`; `fitTile()` sizes the video rectangle between contain and cover
  per the max-crop setting, clips the mesh to it in blank mode (the full piece stays as a dark `hit` mesh
  for the beam) or lets the texture mirror-repeat in mirror mode; re-run on `loadedmetadata`, swap, copy
  and setting changes via `refitTile()` / `refitAll()`.
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
  a pose along the eye→screen line (pitch limited to ±65°, kept clear of walls, floor and ceiling),
  so it opens inside your view whichever surface the screen came from. Its material (and ring, icon,
  panel) render with depth testing off and high `renderOrder`, so walls never cover it; `floatTile.custom`
  is set once the user moves or scales it, after which only its aspect is auto-corrected. `floatTile` is a pseudo-tile with `isFloat` + `origin`, so all
  per-tile actions work on it. Size = `focusSize(dist, aspect)`, distance = `focusDistance()`.
- **Viewer rig**: `rig` group contains the camera and both controllers. Walking/flying move
  it, turning rotates it around the head. Tilting (`pitchRoom`) instead rotates `roomGroup` about
  the head, so the room has its own quaternion. `clampRig()` works in unscaled room-local space
  (`toRoomLocal`/`fromRoomLocal`, `roomPlanes()` = walls + floor + ceiling): while level it pushes
  horizontally and applies the floor/ceiling rule vertically; while tilted every plane pushes along
  its normal and the standing-height rule is off. `recentre()` levels the room.
- **Room scale**: `roomGroup.scale` + `roomGroup.position`, scaled about the head so the
  floor stays at y=0 and walls recede evenly. `commitRoomScale()` bakes the live scale into
  the W/D/H fields on stick release.
- **HUD**: every tile has an `outline` polygon, a `highlight` ring (`makeRing`: quads around the
  outline, clockwise from top-left, `setRingProgress` lights the first k segments) and a floating
  `icon` mesh. `updateHud()` runs every frame: progress on the focused tile, icons on focused or
  audible tiles, sized by distance to the eye (`ICON_DEG`). `panelMesh` (buttons) is a single
  `CanvasTexture` mesh re-parented to the focused tile's surface group, sized by distance
  (`PANEL_DEG`), placed with `fitBand()` in the lowest band of the outline that holds it. Only the
  panel is in the raycast list; `panelButtonAt(uv)` maps hits to buttons.
- **Gamepad mapping** (WebXR standard): 0 trigger, 1 grip, 3 stick click, 4 A/X, 5 B/Y,
  axes 2/3 thumbstick.

## Performance notes

- The 80-face geodesic sphere means 80 decoders at level 1; expect to need a smaller library or
  a lower split than on the other shapes.
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
- Save/restore layouts (grids, room size, which video where).
- Playlists beyond the single like list: named lists, ordering, liked videos as individual board slots, import.
- Per-screen cropping of a mosaic video (many clips in one decoder).
- Native build (Unity/Godot OpenXR) if WebXR limits are hit.
