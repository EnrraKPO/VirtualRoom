import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const SAMPLE = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

// ---- Room dimensions (meters), read from the panel ----
let W = 5, D = 5, H = 3;
function surfaces() {
  return [
    { key: 'front', kind: 'wall', size: [W, H], pos: [0, H / 2, -D / 2], rot: [0, 0, 0] },
    { key: 'back',  kind: 'wall', size: [W, H], pos: [0, H / 2,  D / 2], rot: [0, Math.PI, 0] },
    { key: 'left',  kind: 'wall', size: [D, H], pos: [-W / 2, H / 2, 0], rot: [0, Math.PI / 2, 0] },
    { key: 'right', kind: 'wall', size: [D, H], pos: [ W / 2, H / 2, 0], rot: [0, -Math.PI / 2, 0] },
    { key: 'floor', kind: 'flat', size: [W, D], pos: [0, 0, 0],          rot: [-Math.PI / 2, 0, 0] },
    { key: 'roof',  kind: 'flat', size: [W, D], pos: [0, H, 0],          rot: [ Math.PI / 2, 0, 0] },
  ];
}

// Interaction tuning
const SCRUB_MAX_SPEED = 30;     // seconds of video per second at full stick deflection
const SCRUB_APPLY_HZ = 8;       // how often a seek is actually issued while scrubbing
const WHEEL_STEP = 5;           // seconds per mouse-wheel tick
const KEY_STEP = 10;            // seconds per arrow key press
const LONG_GRIP_MS = 500;       // hold grip this long to ADD audio instead of SOLO

const $ = id => document.getElementById(id);
const setStatus = t => $('status').textContent = t;

// ---- Renderer / scene ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 50);
camera.position.set(0, 1.6, 0);
// The viewer rig: camera and controllers live inside it, so moving the rig moves the player.
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

// ---- Tiles ----
const placeholder = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
const bezelMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
const highlightMat = new THREE.MeshBasicMaterial({ color: 0x4aa8ff });
const roomGroup = new THREE.Group();
scene.add(roomGroup);

let tiles = [];           // [{ mesh, w, h, video, label, highlight }]
let sources = [];         // [{ src, label }]
let videoEls = [];        // all live <video> elements
const tileOf = new Map(); // mesh -> tile

const grids = {};          // surface key -> { cols, rows }
const surfaceGroups = {};  // surface key -> THREE.Group

function buildSurface(s) {
  const { cols, rows } = grids[s.key];
  const bezel = $('bezel').checked ? 0.03 : 0;
  const g = new THREE.Group();
  g.position.set(...s.pos); g.rotation.set(...s.rot);
  roomGroup.add(g);
  surfaceGroups[s.key] = g;
  if (bezel) {
    const back = new THREE.Mesh(new THREE.PlaneGeometry(...s.size), bezelMat);
    back.position.z = -0.006;
    g.add(back);
  }
  const [sw, sh] = s.size;
  const tw = (sw - bezel * (cols + 1)) / cols;
  const th = (sh - bezel * (rows + 1)) / rows;
  const made = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(tw, th), placeholder);
    m.position.set(-sw / 2 + bezel + tw / 2 + c * (tw + bezel),
                    sh / 2 - bezel - th / 2 - r * (th + bezel), 0);
    g.add(m);
    const hl = new THREE.Mesh(new THREE.PlaneGeometry(tw + 0.05, th + 0.05), highlightMat);
    hl.position.copy(m.position); hl.position.z = -0.003; hl.visible = false;
    g.add(hl);
    const tile = { mesh: m, w: tw, h: th, video: null, label: '', highlight: hl, surface: s.key };
    tiles.push(tile); tileOf.set(m, tile); made.push(tile);
  }
  return made;
}

function buildLayout() {
  unfocus(true);
  disposeVideos();
  setFocus(null);
  for (const h of hands) h.hovered = null;
  mouseTile = null;
  roomGroup.clear();
  tiles = []; tileOf.clear();
  W = +$('roomW').value || 5; D = +$('roomD').value || 5; H = +$('roomH').value || 3;
  roomScale = 1; roomGroup.scale.setScalar(1); roomGroup.position.set(0, 0, 0);
  for (const s of surfaces()) {
    grids[s.key] = {
      cols: +$(s.kind === 'wall' ? 'wallCols' : 'flatCols').value,
      rows: +$(s.kind === 'wall' ? 'wallRows' : 'flatRows').value,
    };
    buildSurface(s);
  }
  updateTileCount();
  if (library.length) dealRandom(); else applySources();
}
function updateTileCount() {
  $('tileCount').textContent = `${tiles.length} screens · room ${(W * roomScale).toFixed(1)} × ${(D * roomScale).toFixed(1)} × ${(H * roomScale).toFixed(1)} m`;
}

// Change the grid of ONE surface; other surfaces keep their videos.
async function changeGrid(key, dCols, dRows) {
  const g = grids[key]; if (!g) return;
  const cols = Math.max(1, Math.min(8, g.cols + dCols));
  const rows = Math.max(1, Math.min(8, g.rows + dRows));
  if (cols === g.cols && rows === g.rows) return;
  g.cols = cols; g.rows = rows;
  unfocus(true); setFocus(null);
  for (const h of hands) h.hovered = null;
  mouseTile = null;
  // Tear down this surface's tiles
  const old = tiles.filter(t => t.surface === key);
  tiles = tiles.filter(t => t.surface !== key);
  for (const t of old) {
    tileOf.delete(t.mesh);
    const mat = t.mesh.material;
    if (t.video && !tiles.some(x => x.video === t.video)) {
      killVideo(t.video);
      if (mat !== placeholder && mat.map) { mat.map.dispose(); mat.dispose(); }
    }
  }
  roomGroup.remove(surfaceGroups[key]);
  const s = surfaces().find(x => x.key === key);
  const made = buildSurface(s);
  // Fill the new tiles
  if (library.length) {
    const inUse = new Set(tiles.map(t => t.label));
    let deck = shuffled(library.filter(e => !inUse.has(e.name)));
    for (const t of made) {
      if (!deck.length) deck = shuffled(library);
      const e = deck.pop();
      setTileSource(t, await urlFor(e), e.name);
    }
  } else if (sources.length) {
    made.forEach((t, i) => { const src = sources[i % sources.length]; setTileSource(t, src.src, src.label); });
  }
  updateTileCount();
}

function makeVideo(src) {
  const v = document.createElement('video');
  v.crossOrigin = 'anonymous';
  v.loop = true; v.playsInline = true; v.preload = 'auto';
  v.muted = true;
  v.src = src;
  if ($('randomStart').checked) {
    v.addEventListener('loadedmetadata', () => {
      if (isFinite(v.duration) && v.duration > 1) v.currentTime = Math.random() * (v.duration - 1);
    }, { once: true });
  }
  v.play().catch(() => {});
  videoEls.push(v);
  return v;
}
function makeMaterial(video) {
  const t = new THREE.VideoTexture(video);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  return new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
}
function killVideo(v) {
  v.pause(); v.removeAttribute('src'); v.load();
  videoEls = videoEls.filter(x => x !== v);
}
function disposeVideos() {
  unfocus(true);
  for (const v of videoEls) { v.pause(); v.removeAttribute('src'); v.load(); }
  videoEls = [];
  for (const t of tiles) {
    const mat = t.mesh.material;
    if (mat !== placeholder && mat.map) { mat.map.dispose(); mat.dispose(); }
    t.mesh.material = placeholder; t.video = null; t.label = '';
  }
}
function setTileSource(tile, src, label) {
  if (tile.isFloat) { setTileSource(tile.origin, src, label); syncFloat(); return; }
  const old = tile.video;
  const v = makeVideo(src);
  tile.video = v; tile.label = label;
  const mat = tile.mesh.material;
  if (mat !== placeholder && mat.map && !tiles.some(t => t !== tile && t.mesh.material === mat)) { mat.map.dispose(); mat.dispose(); }
  tile.mesh.material = makeMaterial(v);
  if (old && !tiles.some(t => t.video === old)) killVideo(old);
}

function applySources() {
  disposeVideos();
  if (!sources.length) return;
  if ($('separate').checked) {
    tiles.forEach((t, i) => { const s = sources[i % sources.length]; setTileSource(t, s.src, s.label); });
  } else {
    const shared = new Map(); // src -> { video, mat }
    tiles.forEach((t, i) => {
      const s = sources[i % sources.length];
      if (!shared.has(s.src)) { const v = makeVideo(s.src); shared.set(s.src, { v, mat: makeMaterial(v) }); }
      const e = shared.get(s.src);
      t.video = e.v; t.label = s.label; t.mesh.material = e.mat;
    });
  }
  const names = [...new Set(sources.map(s => s.label))];
  setStatus(`${names.length} source(s) on ${tiles.length} screens, ${videoEls.length} decoder(s): ` +
            (names.length > 8 ? names.slice(0, 8).join(', ') + ', …' : names.join(', ')));
}

// ---- Folder library (File System Access API, handle persisted in IndexedDB) ----
const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov|ogv)$/i;
let library = [];          // [{ handle, name, url? }]

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('video-room', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function kvSet(k, v) { const db = await idb(); const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); return new Promise(r => tx.oncomplete = r); }
async function kvGet(k) { const db = await idb(); return new Promise(r => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(undefined); }); }

async function scanFolder(dir) {
  for (const e of library) if (e.url) URL.revokeObjectURL(e.url);
  library = [];
  for await (const [name, h] of dir.entries()) if (h.kind === 'file' && VIDEO_EXT.test(name)) library.push({ handle: h, name });
  library.sort((a, b) => a.name.localeCompare(b.name));
  $('libInfo').textContent = `${library.length} videos in "${dir.name}"`;
}
async function urlFor(entry) {
  if (!entry.url) entry.url = URL.createObjectURL(await entry.handle.getFile());
  return entry.url;
}
async function openFolder(dir) {
  await scanFolder(dir);
  if (!library.length) { setStatus('No video files found in that folder.'); return; }
  await dealRandom();
}
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
async function dealRandom() {
  if (!library.length) return;
  disposeVideos();
  let deck = [];
  for (const t of tiles) {
    if (!deck.length) deck = shuffled(library);
    const e = deck.pop();
    setTileSource(t, await urlFor(e), e.name);
  }
  setStatus(`${tiles.length} screens, ${videoEls.length} decoder(s) from ${library.length} library videos.`);
}
// Swap one tile to a random library video not currently on any screen (if possible)
async function swapTile(tile) {
  if (!library.length) { setStatus('Swap needs a folder library.'); return; }
  const inUse = new Set(tiles.map(t => t.label));
  let pool = library.filter(e => e.name !== tile.label && !inUse.has(e.name));
  if (!pool.length) pool = library.filter(e => e.name !== tile.label);
  if (!pool.length) return;
  const e = pool[Math.floor(Math.random() * pool.length)];
  setTileSource(tile, await urlFor(e), e.name);
}

$('pickFolder').addEventListener('click', async () => {
  if (!window.showDirectoryPicker) { setStatus('Folder picking needs Chrome or Edge.'); return; }
  try {
    const dir = await showDirectoryPicker({ mode: 'read' });
    await kvSet('folder', dir);
    await openFolder(dir);
  } catch (e) { if (e.name !== 'AbortError') setStatus('Folder error: ' + e.message); }
});
$('shuffle').addEventListener('click', dealRandom);
(async () => {
  const dir = await kvGet('folder');
  if (!dir) return;
  const perm = await dir.queryPermission({ mode: 'read' });
  if (perm === 'granted') { await openFolder(dir); return; }
  $('libInfo').textContent = `Click to reopen "${dir.name}"`;
  $('libInfo').style.cursor = 'pointer';
  $('libInfo').onclick = async () => {
    if (await dir.requestPermission({ mode: 'read' }) === 'granted') { $('libInfo').onclick = null; await openFolder(dir); }
  };
})();

// ---- Other UI ----
function clearLibrary() { for (const e of library) if (e.url) URL.revokeObjectURL(e.url); library = []; $('libInfo').textContent = ''; }
$('apply').addEventListener('click', buildLayout);
$('files').addEventListener('change', e => {
  const fs = [...e.target.files]; if (!fs.length) return;
  clearLibrary();
  sources = fs.map(f => ({ src: URL.createObjectURL(f), label: f.name }));
  applySources();
});
$('useSample').addEventListener('click', () => { clearLibrary(); sources = [{ src: SAMPLE, label: 'Sample' }]; applySources(); });
$('clear').addEventListener('click', () => { clearLibrary(); sources = []; disposeVideos(); setStatus('Cleared.'); });
$('separate').addEventListener('change', () => { if (!library.length) applySources(); });
$('mute').addEventListener('change', e => { if (e.target.checked) for (const v of videoEls) v.muted = true; });

const resumeAll = () => { for (const v of videoEls) if (v.paused && !v._userPaused) v.play().catch(() => {}); };
addEventListener('click', resumeAll);
renderer.xr.addEventListener('sessionstart', resumeAll);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- Per-tile actions ----
function toggleAudio(tile, additive) {
  const v = tile.video; if (!v) return;
  if (v.muted) {
    if (!additive) for (const x of videoEls) x.muted = true;
    v.muted = false; $('mute').checked = false;
  } else {
    v.muted = true;
    if (videoEls.every(x => x.muted)) $('mute').checked = true;
  }
}
// Exchange the videos of two screens
function swapPlaces(a, b) {
  if (a.isFloat) a = a.origin; if (b.isFloat) b = b.origin;
  if (!a || !b || a === b) return;
  unfocus(true);
  [a.video, b.video] = [b.video, a.video];
  [a.label, b.label] = [b.label, a.label];
  [a.mesh.material, b.mesh.material] = [b.mesh.material, a.mesh.material];
}
// Put the same video (same decoder, in sync) on another screen
function copyTo(src, dst) {
  if (src.isFloat) src = src.origin; if (dst.isFloat) dst = dst.origin;
  if (!src || !dst || src === dst || !src.video) return;
  unfocus(true);
  const old = dst.video, oldMat = dst.mesh.material;
  dst.video = src.video; dst.label = src.label; dst.mesh.material = src.mesh.material;
  if (old && !tiles.some(t => t.video === old)) {
    killVideo(old);
    if (oldMat !== placeholder && oldMat.map) { oldMat.map.dispose(); oldMat.dispose(); }
  }
}

// ---- Live room scaling (thumbstick up/down); geometry is reused, the group is scaled ----
const ROOM_SCALE_SPEED = 0.9;   // ~e-fold per second at full deflection
let roomScale = 1;
function scaleRoom(f) {
  const base = Math.min(W, D, H);
  const s0 = roomScale;
  roomScale = Math.max(1.5 / base, Math.min(40 / base, roomScale * f));
  // Scale about the viewer's head (horizontally; the floor stays at y = 0):
  // keep the head's position in room-local space unchanged by shifting the room.
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(_head);
  const lx = (_head.x - roomGroup.position.x) / s0, lz = (_head.z - roomGroup.position.z) / s0;
  roomGroup.scale.setScalar(roomScale);
  roomGroup.position.x = _head.x - lx * roomScale;
  roomGroup.position.z = _head.z - lz * roomScale;
  clampRig();
  updateTileCount();
}
// Bake the live scale into the panel's W/D/H fields so Apply layout keeps the current size
function commitRoomScale() {
  $('roomW').value = (W * roomScale).toFixed(1);
  $('roomD').value = (D * roomScale).toFixed(1);
  $('roomH').value = (H * roomScale).toFixed(1);
}

// Jump to a random point in the timeline
function jumpRandom(tile) {
  const v = tile && tile.video; if (!v || !isFinite(v.duration) || v.duration < 2) return;
  v.currentTime = Math.random() * (v.duration - 1);
}
// Optional auto-jump: each video gets its own jittered timer so they don't all cut at once
setInterval(() => {
  const every = +$('autoJump').value || 0; if (!every) return;
  const now = performance.now();
  for (const v of videoEls) {
    if (!v._nextJump) v._nextJump = now + every * 1000 * (0.5 + Math.random());
    if (now >= v._nextJump && !v.paused && isFinite(v.duration)) {
      v.currentTime = Math.random() * (v.duration - 1);
      v._nextJump = now + every * 1000 * (0.75 + Math.random() * 0.5);
    }
  }
}, 250);

function togglePause(tile) {
  const v = tile.video; if (!v) return;
  if (v.paused) { v._userPaused = false; v.play().catch(() => {}); }
  else { v._userPaused = true; v.pause(); }
}
function seekBy(tile, dt) {
  const v = tile && tile.video; if (!v || !isFinite(v.duration)) return;
  const d = v.duration;
  v.currentTime = ((v.currentTime + dt) % d + d) % d;
}

// ---- Focus mode: lift one screen off the wall into a big floating panel ----
const FOCUS_ANIM_MS = 450;
const dimMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
const floatGroup = new THREE.Group();
scene.add(floatGroup);
const floatMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), placeholder);
const floatHL = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), highlightMat);
floatHL.position.z = -0.003; floatHL.visible = false; floatHL.scale.set(1.012, 1.018, 1);
floatGroup.add(floatMesh, floatHL);
floatGroup.visible = false;
const floatTile = { mesh: floatMesh, w: 1, h: 1, video: null, label: '', highlight: floatHL, isFloat: true, origin: null };
let focused = null;                    // the wall tile currently lifted out
let anim = null;                       // { from:{p,q,s}, to:{p,q,s}, t0, dir:+1|-1 }
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _eye = new THREE.Vector3();

function syncFloat() {
  if (!focused) return;
  floatTile.video = focused.video; floatTile.label = focused.label;
  const prev = floatMesh.material;
  if (prev !== placeholder && prev !== focused.mesh.material && prev.map) { prev.map.dispose(); prev.dispose(); }
  floatMesh.material = focused.mesh.material;
  focused.mesh.material = dimMat;     // wall slot goes dark while its video is out
}
function applyDim(on) {
  const dim = on && $('dimOthers').checked;
  for (const t of tiles) if (t !== focused && t.mesh.material !== placeholder && t.mesh.material !== dimMat)
    t.mesh.material.color.setScalar(dim ? 0.25 : 1);
}
function focusTarget() {
  // In front of the viewer, at eye height, facing them. Uses the live XR head pose when presenting.
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(_eye);
  cam.getWorldDirection(_fwd); _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1); else _fwd.normalize();
  // Distance: a comfortable fixed distance, but never past the nearest wall in that direction.
  const dist = focusDistance(_eye, _fwd);
  const v = focused.video;
  const aspect = v && v.videoWidth ? v.videoWidth / v.videoHeight : focused.w / focused.h;
  const [fw, fh] = focusSize(dist, aspect);
  const p = _eye.clone().addScaledVector(_fwd, dist);
  p.y = Math.min(Math.max(fh / 2 + 0.05, _eye.y), Math.max(_eye.y, H * roomScale - fh / 2 - 0.05));
  // PlaneGeometry faces +z; Matrix4.lookAt(eye, target) points +z from target toward eye,
  // so pass the viewer as "eye" and the panel as "target" to make the panel face the viewer.
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(_eye.clone().setY(p.y), p, new THREE.Vector3(0, 1, 0)));
  return { p, q, s: new THREE.Vector3(fw, fh, 1) };
}
// How far in front of the viewer the focus screen sits: 2.5 m, or 85% of the way to the wall if closer.
function focusDistance(eye, fwd) {
  const ox = roomGroup.position.x, oz = roomGroup.position.z;
  const hx = W * roomScale / 2, hz = D * roomScale / 2;
  let toWall = Infinity;
  if (fwd.x > 1e-4) toWall = Math.min(toWall, (ox + hx - eye.x) / fwd.x);
  if (fwd.x < -1e-4) toWall = Math.min(toWall, (ox - hx - eye.x) / fwd.x);
  if (fwd.z > 1e-4) toWall = Math.min(toWall, (oz + hz - eye.z) / fwd.z);
  if (fwd.z < -1e-4) toWall = Math.min(toWall, (oz - hz - eye.z) / fwd.z);
  return Math.max(0.6, Math.min(2.5, toWall * 0.85));
}
// Size so the screen fills the chosen horizontal field of view at that distance,
// capped by the room height so it never pokes through floor or ceiling.
function focusSize(dist, aspect) {
  const fovDeg = +$('focusFov').value || 80;
  let fw = 2 * dist * Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
  let fh = fw / aspect;
  const maxH = H * roomScale - 0.1;
  if (fh > maxH) { fh = maxH; fw = fh * aspect; }
  return [fw, fh];
}
function tilePose(tile) {
  tile.mesh.updateWorldMatrix(true, false);
  tile.mesh.matrixWorld.decompose(_p, _q, _s);
  return { p: _p.clone(), q: _q.clone(), s: new THREE.Vector3(tile.w * _s.x, tile.h * _s.y, 1) };
}
function focusOn(tile) {
  if (tile.isFloat) { unfocus(); return; }
  if (focused) { unfocus(true); }
  focused = tile; floatTile.origin = tile;
  syncFloat();
  floatGroup.visible = true;
  const from = tilePose(tile), to = focusTarget();
  anim = { from, to, t0: performance.now(), dir: 1 };
  floatGroup.position.copy(from.p); floatGroup.quaternion.copy(from.q); floatGroup.scale.copy(from.s);
  applyDim(true);
  setFocus(floatTile);
}
function unfocus(immediate = false) {
  if (!focused) return;
  const tile = focused;
  const from = { p: floatGroup.position.clone(), q: floatGroup.quaternion.clone(), s: floatGroup.scale.clone() };
  const to = tilePose(tile);
  const restore = () => {
    tile.mesh.material = floatMesh.material; floatMesh.material = placeholder;
    floatGroup.visible = false; floatTile.video = null; floatTile.origin = null;
  };
  applyDim(false);
  if (focusTile === floatTile) setFocus(null);
  focused = null;
  if (immediate) { restore(); anim = null; return; }
  anim = { from, to, t0: performance.now(), dir: -1, done: restore };
}
function toggleFocus(tile) {
  if (!tile) { if (focused) unfocus(); return; }
  if (tile.isFloat || tile === focused) unfocus(); else focusOn(tile);
}
function updateFocusAnim(now) {
  if (!anim) return;
  let t = Math.min(1, (now - anim.t0) / FOCUS_ANIM_MS);
  const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in-out
  floatGroup.position.lerpVectors(anim.from.p, anim.to.p, e);
  floatGroup.quaternion.slerpQuaternions(anim.from.q, anim.to.q, e);
  floatGroup.scale.lerpVectors(anim.from.s, anim.to.s, e);
  if (t >= 1) { const d = anim.done; anim = null; if (d) d(); }
}
// Once the focused video's metadata arrives, fix the float's aspect ratio
setInterval(() => {
  if (!focused || anim) return;
  const v = focused.video; if (!v || !v.videoWidth) return;
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(_eye);
  const dist = _eye.distanceTo(floatGroup.position);
  const [fw, fh] = focusSize(dist, v.videoWidth / v.videoHeight);
  if (Math.abs(floatGroup.scale.y - fh) > 0.01 || Math.abs(floatGroup.scale.x - fw) > 0.01) floatGroup.scale.set(fw, fh, 1);
}, 500);

// ---- Info strip (canvas texture, shown on the focused tile only) ----
const stripCanvas = document.createElement('canvas');
stripCanvas.width = 1400; stripCanvas.height = 96;
// Grid buttons drawn at the right end of the strip (canvas px). Clicked via the beam or mouse.
const BTN_W = 64, BTN_GAP = 8, BTN_AREA = 4 * BTN_W + 3 * BTN_GAP + 110;
const STRIP_BUTTONS = [
  { label: '−', title: 'cols', dc: -1, dr: 0 }, { label: '+', title: 'cols', dc: 1, dr: 0 },
  { label: '−', title: 'rows', dc: 0, dr: -1 }, { label: '+', title: 'rows', dc: 0, dr: 1 },
].map((b, i) => ({ ...b, x0: 1400 - BTN_AREA + 110 + i * (BTN_W + BTN_GAP) + (i >= 2 ? 24 : 0), x1: 0 }));
for (const b of STRIP_BUTTONS) b.x1 = b.x0 + BTN_W;
let stripHoverBtn = -1;
// Map a hit on the strip mesh to a button index (or -1)
function stripButtonAt(uv) {
  if (!uv) return -1;
  const x = uv.x * stripCanvas.width, y = (1 - uv.y) * stripCanvas.height;
  if (y < 26 || y > 94) return -1;
  return STRIP_BUTTONS.findIndex(b => x >= b.x0 - 4 && x <= b.x1 + 4);
}
function pressStripButton(tile, idx) {
  const b = STRIP_BUTTONS[idx]; if (!b) return;
  const t = tile.isFloat ? tile.origin : tile;
  if (t && t.surface) changeGrid(t.surface, b.dc, b.dr);
}
const stripCtx = stripCanvas.getContext('2d');
const stripTex = new THREE.CanvasTexture(stripCanvas);
stripTex.colorSpace = THREE.SRGBColorSpace;
const stripMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: stripTex, transparent: true, depthTest: false }));
stripMesh.renderOrder = 10; stripMesh.visible = false;

const fmt = s => { s = Math.max(0, s | 0); const m = (s / 60) | 0, h = (m / 60) | 0; return (h ? h + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
function drawStrip(tile) {
  const c = stripCtx, v = tile.video, Wc = stripCanvas.width, Hc = stripCanvas.height;
  c.clearRect(0, 0, Wc, Hc);
  c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(0, 0, Wc, Hc);
  const dur = v && isFinite(v.duration) ? v.duration : 0;
  const prog = dur ? v.currentTime / dur : 0;
  c.fillStyle = '#333'; c.fillRect(24, 14, Wc - 48, 10);
  c.fillStyle = '#4aa8ff'; c.fillRect(24, 14, (Wc - 48) * prog, 10);
  c.font = '34px system-ui, sans-serif'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
  let name = tile.label || '(empty)';
  while (c.measureText(name).width > Wc - BTN_AREA - 440 && name.length > 4) name = name.slice(0, -2);
  c.fillText(name, 24, 60);
  const R = Wc - BTN_AREA;   // right edge of the info area
  c.textAlign = 'right';
  c.fillText(v ? `${fmt(v.currentTime)} / ${fmt(dur)}` : '', R - 150, 60);
  c.textAlign = 'left';
  // grid buttons: "3×2" then [− +] cols [− +] rows
  const src = tile.isFloat ? tile.origin : tile;
  const g = src && grids[src.surface];
  c.fillStyle = '#aaa'; c.font = '28px system-ui, sans-serif';
  c.fillText(g ? `${g.cols}×${g.rows}` : '', R + 14, 60);
  STRIP_BUTTONS.forEach((b, i) => {
    c.fillStyle = i === stripHoverBtn ? '#4aa8ff' : '#2a2a2a';
    c.beginPath(); c.roundRect(b.x0, 30, BTN_W, 56, 10); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 36px system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText(b.label, b.x0 + BTN_W / 2, 58);
    if (i === 0 || i === 2) { c.fillStyle = '#aaa'; c.font = '18px system-ui, sans-serif'; c.fillText(b.title, b.x0 + BTN_W + BTN_GAP / 2, 20); }
  });
  c.textAlign = 'left';
  // speaker icon
  const sx = R - 120, sy = 60;
  c.fillStyle = v && !v.muted ? '#4aff8a' : '#888';
  c.beginPath(); c.moveTo(sx, sy - 10); c.lineTo(sx + 12, sy - 10); c.lineTo(sx + 28, sy - 24); c.lineTo(sx + 28, sy + 24); c.lineTo(sx + 12, sy + 10); c.lineTo(sx, sy + 10); c.closePath(); c.fill();
  if (v && !v.muted) { c.strokeStyle = '#4aff8a'; c.lineWidth = 4; c.beginPath(); c.arc(sx + 30, sy, 18, -0.9, 0.9); c.stroke(); }
  else { c.strokeStyle = '#f66'; c.lineWidth = 5; c.beginPath(); c.moveTo(sx + 36, sy - 14); c.lineTo(sx + 60, sy + 14); c.moveTo(sx + 60, sy - 14); c.lineTo(sx + 36, sy + 14); c.stroke(); }
  // pause mark
  if (v && v.paused) { c.fillStyle = '#ffd24a'; c.fillRect(R - 48, sy - 18, 10, 36); c.fillRect(R - 30, sy - 18, 10, 36); }
  stripTex.needsUpdate = true;
}

let focusTile = null;
function setFocus(tile) {
  if (focusTile === tile) return;
  if (focusTile) { focusTile.highlight.visible = false; }
  focusTile = tile;
  if (tile) {
    tile.highlight.visible = true;
    tile.mesh.parent.add(stripMesh);
    if (tile.isFloat) {
      // floatGroup is scaled to the screen size, so position/scale in unit space
      const sh = Math.min(0.14, 0.22 / floatGroup.scale.y);
      stripMesh.scale.set(1, sh, 1);
      stripMesh.position.set(0, -0.5 + sh / 2, 0.004);
    } else {
      const sh = Math.min(tile.h * 0.14, 0.22);
      stripMesh.scale.set(tile.w, sh, 1);
      stripMesh.position.set(tile.mesh.position.x, tile.mesh.position.y - tile.h / 2 + sh / 2, 0.004);
    }
    stripMesh.visible = true;
  } else {
    stripMesh.visible = false;
  }
}

// ---- VR controllers: laser pointer + buttons ----
const raycaster = new THREE.Raycaster();
const hands = [];
for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const beam = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.6 }));
  beam.scale.z = 10;
  ctrl.add(beam);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  dot.visible = false; scene.add(dot);
  const hand = { ctrl, beam, dot, hovered: null, prev: {}, gripDownAt: 0, scrubAcc: 0, lastSeek: 0, source: null, drag: null, scaling: false };
  ctrl.addEventListener('connected', e => { hand.source = e.data; });
  ctrl.addEventListener('disconnected', () => { hand.source = null; hand.hovered = null; });
  rig.add(ctrl);
  hands.push(hand);
}

const tmpM = new THREE.Matrix4();
function updateHand(hand, dt, now) {
  if (!hand.source) { hand.dot.visible = false; return; }
  tmpM.identity().extractRotation(hand.ctrl.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(hand.ctrl.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpM);
  const hit = raycaster.intersectObjects(rayTargets(), false)[0];
  const onStrip = hit && hit.object === stripMesh;
  const tile = hit ? (onStrip ? focusTile : tileFor(hit.object)) : null;
  if (hit) { hand.dot.position.copy(hit.point); hand.dot.visible = true; hand.beam.scale.z = hit.distance; }
  else { hand.dot.visible = false; hand.beam.scale.z = 10; }
  if (tile && tile !== hand.hovered) setFocus(tile);
  hand.hovered = tile;
  const btn = onStrip ? stripButtonAt(hit.uv) : -1;
  if (btn !== stripHoverBtn) { stripHoverBtn = btn; if (focusTile) drawStrip(focusTile); }

  const gp = hand.source.gamepad; if (!gp) return;
  // Trigger on a strip button: do that and nothing else this press
  if (btn >= 0 && gp.buttons[0] && gp.buttons[0].pressed && !hand.prev.trigger) {
    pressStripButton(tile, btn); hand.prev.trigger = true; return;
  }
  const b = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const trigger = b(0), grip = b(1), stick = b(3), primary = b(4), secondary = b(5);
  const p = hand.prev;

  if (secondary && !p.secondary) toggleFocus(tile);

  // Thumbstick (axes 2,3 on standard mapping; fall back to 0,1).
  const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
  const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] || 0;
  const dz = 0.15;
  const stickActive = Math.hypot(ax, ay) > dz;

  // Grip + stick = walk. Grip + trigger + stick = fly (stick up/down = rise/sink, left/right = strafe).
  // Once moving starts, that grip/trigger press is no longer a copy/swap/audio gesture.
  if (grip && stickActive) {
    if (hand.drag) cancelDrag(hand);
    hand.walking = true;
    if (trigger) moveRig(ax, 0, dt, -ay); else moveRig(ax, ay, dt, 0);
  }
  // Trigger (without grip) + stick left/right = turn in place.
  if (trigger && !grip && Math.abs(ax) > dz && Math.abs(ax) >= Math.abs(ay)) {
    if (hand.drag) cancelDrag(hand);
    hand.turning = true;
    const n = (Math.abs(ax) - dz) / (1 - dz);
    turnRig(-Math.sign(ax) * n * n * TURN_SPEED * dt);
  }
  if (!trigger && p.trigger) hand.turning = false;
  if (grip && stick && !p.stick) recentre();                            // grip + stick click = back to centre
  else if (tile && stick && !p.stick) jumpRandom(tile);
  if (!grip && p.grip) hand.walking = false;

  // Press on a screen starts a potential drag; release decides: same screen = tap action,
  // different screen = two-screen action (trigger drag = swap places, grip drag = copy).
  if (trigger && !p.trigger && tile) startDrag(hand, 'swap', tile, now);
  if (grip && !p.grip && tile) startDrag(hand, 'copy', tile, now);
  if (!trigger && p.trigger && hand.drag && hand.drag.kind === 'swap') endDrag(hand, tile, now);
  if (!grip && p.grip && hand.drag && hand.drag.kind === 'copy') endDrag(hand, tile, now);

  if (tile && primary && !p.primary) togglePause(tile);

  // Without grip or trigger: left/right scrubs the pointed-at screen, up/down scales the whole room.
  const x = !grip && !trigger && Math.abs(ax) >= Math.abs(ay) ? ax : 0;
  const y = !grip && !trigger && Math.abs(ay) > Math.abs(ax) ? ay : 0;
  if (tile && Math.abs(x) > dz) {
    const n = (Math.abs(x) - dz) / (1 - dz);
    hand.scrubAcc += Math.sign(x) * n * n * SCRUB_MAX_SPEED * dt;
    if (now - hand.lastSeek > 1000 / SCRUB_APPLY_HZ) { seekBy(tile, hand.scrubAcc); hand.scrubAcc = 0; hand.lastSeek = now; }
  } else if (hand.scrubAcc) { seekBy(tile || hand.hovered, hand.scrubAcc); hand.scrubAcc = 0; }
  if (Math.abs(y) > dz) {
    const n = (Math.abs(y) - dz) / (1 - dz);
    scaleRoom(Math.exp(-Math.sign(y) * n * ROOM_SCALE_SPEED * dt)); // stick up (y<0) = bigger
    hand.scaling = true;
  } else if (hand.scaling) { hand.scaling = false; commitRoomScale(); }

  p.trigger = trigger; p.grip = grip; p.stick = stick; p.primary = primary; p.secondary = secondary;
}

// ---- Locomotion: move the rig along the head's horizontal facing, clamped inside the room ----
const WALK_SPEED = 2.0;  // m/s at full deflection, scaled with the room
const _head = new THREE.Vector3(), _hf = new THREE.Vector3(), _hr = new THREE.Vector3();
function moveRig(ax, ay, dt, up = 0) {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldDirection(_hf); _hf.y = 0;
  if (_hf.lengthSq() < 1e-4) _hf.set(0, 0, -1); else _hf.normalize();
  _hr.set(-_hf.z, 0, _hf.x);                       // right = forward rotated 90° clockwise
  const speed = WALK_SPEED * Math.max(1, roomScale) * dt;
  rig.position.addScaledVector(_hf, -ay * speed);  // stick up (ay<0) = forward
  rig.position.addScaledVector(_hr, ax * speed);
  rig.position.y += up * speed;                    // levitate
  clampRig();
}
// Rotate the rig about the viewer's head so you turn in place
const TURN_SPEED = THREE.MathUtils.degToRad(120);   // rad/s at full deflection
const _rot = new THREE.Quaternion(), _yAxis = new THREE.Vector3(0, 1, 0);
function turnRig(angle) {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(_head);
  _rot.setFromAxisAngle(_yAxis, angle);
  rig.position.sub(_head).applyQuaternion(_rot).add(_head);
  rig.quaternion.premultiply(_rot);
}
// Put the viewer's head at the room's centre
function recentre() {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(_head);
  rig.position.x += roomGroup.position.x - _head.x;
  rig.position.z += roomGroup.position.z - _head.z;
  rig.position.y = 0;
}
function clampRig() {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(_head);
  const m = 0.25, hx = W * roomScale / 2 - m, hz = D * roomScale / 2 - m;
  const ox = roomGroup.position.x, oz = roomGroup.position.z;
  const cx = Math.max(ox - hx, Math.min(ox + hx, _head.x)), cz = Math.max(oz - hz, Math.min(oz + hz, _head.z));
  rig.position.x += cx - _head.x;
  rig.position.z += cz - _head.z;
  // Vertical: never below your real standing height, never through the ceiling
  const headAboveRig = _head.y - rig.position.y;
  const minY = 0, maxY = Math.max(0, H * roomScale - m - headAboveRig);
  rig.position.y = Math.max(minY, Math.min(maxY, rig.position.y));
}
function cancelDrag(hand) {
  hand.drag = null;
  hand.beam.material.color.setHex(DRAG_COLORS.idle);
}

const DRAG_COLORS = { swap: 0xffa040, copy: 0x4aff8a, idle: 0x4aa8ff };
function startDrag(hand, kind, tile, now) {
  hand.drag = { kind, from: tile, t0: now };
  hand.beam.material.color.setHex(DRAG_COLORS[kind]);
  if (kind === 'copy') hand.gripDownAt = now;
}
function endDrag(hand, target, now) {
  const { kind, from, t0 } = hand.drag;
  hand.drag = null;
  hand.beam.material.color.setHex(DRAG_COLORS.idle);
  if (target && target !== from) {
    if (kind === 'swap') swapPlaces(from, target); else copyTo(from, target);
  } else if (target === from) {
    if (kind === 'swap') swapTile(from); else toggleAudio(from, now - t0 >= LONG_GRIP_MS);
  }
}
function rayTargets() {
  const t = tiles.map(x => x.mesh);
  if (focused && !anim) t.push(floatMesh);
  if (stripMesh.visible) t.unshift(stripMesh);   // strip sits in front of its tile; test it first
  return t;
}
function tileFor(obj) { return obj === floatMesh ? floatTile : tileOf.get(obj); }

// ---- Desktop: mouse look + hover + actions ----
let yaw = 0, pitch = 0, dragging = false, downX = 0, downY = 0, moved = false;
const mouse = new THREE.Vector2(2, 2);
let mouseTile = null;
renderer.domElement.addEventListener('pointerdown', e => { dragging = true; moved = false; downX = e.clientX; downY = e.clientY; });
addEventListener('pointerup', e => {
  dragging = false;
  if (e.target !== renderer.domElement || renderer.xr.isPresenting) return;
  if (moved) return;
  if (e.button === 0 && mouseTile && stripHoverBtn >= 0) { pressStripButton(mouseTile, stripHoverBtn); return; }
  if (e.button === 0 && mouseTile) swapTile(mouseTile);
  if (e.button === 2 && mouseTile) toggleAudio(mouseTile, e.shiftKey);
});
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('pointermove', e => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (!dragging || renderer.xr.isPresenting) return;
  if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) moved = true;
  yaw -= e.movementX * 0.004; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.004));
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
});
renderer.domElement.addEventListener('wheel', e => { if (mouseTile) { e.preventDefault(); seekBy(mouseTile, Math.sign(e.deltaY) * WHEEL_STEP); } }, { passive: false });
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || !mouseTile) return;
  if (e.code === 'Space') { e.preventDefault(); togglePause(mouseTile); }
  if (e.code === 'ArrowRight') seekBy(mouseTile, KEY_STEP);
  if (e.code === 'ArrowLeft') seekBy(mouseTile, -KEY_STEP);
  if (e.code === 'KeyM') toggleAudio(mouseTile, e.shiftKey);
});
let marked = null;   // desktop: first screen of a two-screen action
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'KeyF') toggleFocus(mouseTile);
  if (e.code === 'KeyR') jumpRandom(mouseTile);
  if ((e.code === 'KeyX' || e.code === 'KeyC') && mouseTile) {
    if (!marked) { marked = mouseTile; setStatus(`Marked "${mouseTile.label}". Hover another screen and press X to swap or C to copy.`); }
    else {
      if (e.code === 'KeyX') swapPlaces(marked, mouseTile); else copyTo(marked, mouseTile);
      marked = null; setStatus(e.code === 'KeyX' ? 'Swapped.' : 'Copied.');
    }
  }
  if (e.code === 'Escape') { marked = null; }
  if (e.code === 'Equal' || e.code === 'NumpadAdd') { scaleRoom(1.1); commitRoomScale(); }
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') { scaleRoom(1 / 1.1); commitRoomScale(); }
});
// Desktop WASD walking
const keys = new Set();
addEventListener('keydown', e => { if (e.target.tagName !== 'INPUT') keys.add(e.code); });
addEventListener('keyup', e => keys.delete(e.code));
function updateDesktopWalk(dt) {
  let ax = 0, ay = 0;
  if (keys.has('KeyW')) ay -= 1; if (keys.has('KeyS')) ay += 1;
  if (keys.has('KeyA')) ax -= 1; if (keys.has('KeyD')) ax += 1;
  let up = 0;
  if (keys.has('KeyE')) up += 1; if (keys.has('KeyQ')) up -= 1;
  if (ax || ay || up) moveRig(ax, ay, dt, up);
}
function updateMouse() {
  if (renderer.xr.isPresenting) { mouseTile = null; return; }
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObjects(rayTargets(), false)[0];
  const onStrip = hit && hit.object === stripMesh;
  const tile = hit ? (onStrip ? focusTile : tileFor(hit.object)) : null;
  if (tile !== mouseTile) { mouseTile = tile; setFocus(tile); }
  const btn = onStrip ? stripButtonAt(hit.uv) : -1;
  if (btn !== stripHoverBtn) { stripHoverBtn = btn; if (focusTile) drawStrip(focusTile); }
}

// ---- Stats ----
let frames = 0, last = performance.now();
setInterval(() => {
  const now = performance.now();
  const fps = Math.round(frames * 1000 / (now - last));
  frames = 0; last = now;
  let dropped = 0, total = 0, stalled = 0, audible = 0;
  for (const v of videoEls) {
    if (v.getVideoPlaybackQuality) { const q = v.getVideoPlaybackQuality(); dropped += q.droppedVideoFrames; total += q.totalVideoFrames; }
    if (v.readyState < 3 || v.paused) stalled++;
    if (!v.muted) audible++;
  }
  const pct = total ? (100 * dropped / total).toFixed(1) : '0.0';
  $('stats').textContent =
    `Render: ${fps} fps${renderer.xr.isPresenting ? ' (VR)' : ''}\n` +
    `Decoders: ${videoEls.length}   audible: ${audible}   dropped: ${dropped}/${total} (${pct}%)   stalled/paused: ${stalled}`;
}, 1000);

// ---- Diagnostics ----
(async () => {
  const lines = [];
  const ua = navigator.userAgent.match(/(Edg|Chrome|Firefox)\/[\d.]+/);
  lines.push('Browser: ' + (ua ? ua[0] : 'unknown') + ', secure: ' + isSecureContext + ' (' + location.host + ')');
  if (!navigator.xr) lines.push('navigator.xr: MISSING. Use Chrome or Edge via http://localhost:5173.');
  else {
    const ok = await navigator.xr.isSessionSupported('immersive-vr').catch(e => e.message);
    lines.push('immersive-vr: ' + ok + (ok === true ? '' : ' (is SteamVR running as the OpenXR runtime?)'));
  }
  $('diag').textContent = lines.join('\n');
})();

// ---- Main loop ----
buildLayout();
const clock = new THREE.Clock();
let stripTick = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1), now = performance.now();
  frames++;
  updateFocusAnim(now);
  if (renderer.xr.isPresenting) for (const h of hands) updateHand(h, dt, now);
  else { updateMouse(); updateDesktopWalk(dt); }
  if (focusTile && now - stripTick > 100) { drawStrip(focusTile); stripTick = now; }
  renderer.render(scene, camera);
});
