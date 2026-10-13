import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const SAMPLE = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

// ---- Room dimensions (meters), read from the panel ----
let W = 5, D = 5, H = 3;
let shape = 'box', N = 4;   // 'box', 'prism' (N walls) or a polyhedron; for non-box shapes W is the width across flats and D = W
const POLY_SHAPES = { tetra: 1, octa: 1, dodeca: 1, icosa: 1, geo2: 1, trap: 1 };   // trap = N-trapezohedron, 2N kites
const isPoly = () => !!POLY_SHAPES[shape];

// Walls/faces as planes: outward unit normal and distance from the room centre, unscaled.
// The centre is (0, polyCentreY, 0) in room space; floor faces are left out (the y clamp handles them).
let polyCentreY = 0;
function wallPlanes() {
  if (shape === 'box') return [{ nx: 0, ny: 0, nz: -1, dist: D / 2 }, { nx: 0, ny: 0, nz: 1, dist: D / 2 }, { nx: -1, ny: 0, nz: 0, dist: W / 2 }, { nx: 1, ny: 0, nz: 0, dist: W / 2 }];
  if (isPoly()) return polyhedron(shape, W, N).faces.filter(f => f.n.y > -0.99).map(f => ({ nx: f.n.x, ny: f.n.y, nz: f.n.z, dist: f.dist }));
  const a = W / 2, out = [];
  for (let i = 0; i < N; i++) { const phi = i * 2 * Math.PI / N; out.push({ nx: Math.sin(phi), ny: 0, nz: -Math.cos(phi), dist: a }); }
  return out;
}
// All room planes in unscaled room-local space: walls/faces plus floor and ceiling.
function roomPlanes() {
  return [...wallPlanes(), { nx: 0, ny: -1, nz: 0, dist: polyCentreY }, { nx: 0, ny: 1, nz: 0, dist: H - polyCentreY }];
}
// The room can be tilted (pitched about the viewer); these map between world and unscaled room-local space.
const _rq = new THREE.Quaternion(), _lv = new THREE.Vector3(), _lv2 = new THREE.Vector3();
const roomLevel = () => roomGroup.quaternion.w > 0.99999;
function toRoomLocal(v, out) { return out.copy(v).sub(roomGroup.position).applyQuaternion(_rq.copy(roomGroup.quaternion).invert()).multiplyScalar(1 / roomScale); }
function toRoomLocalDir(v, out) { return out.copy(v).applyQuaternion(_rq.copy(roomGroup.quaternion).invert()); }
function fromRoomLocal(l, out) { return out.copy(l).multiplyScalar(roomScale).applyQuaternion(roomGroup.quaternion).add(roomGroup.position); }
function surfaces() {
  if (shape === 'box') return [
    { key: 'front', kind: 'wall', size: [W, H], pos: [0, H / 2, -D / 2], rot: [0, 0, 0] },
    { key: 'back',  kind: 'wall', size: [W, H], pos: [0, H / 2,  D / 2], rot: [0, Math.PI, 0] },
    { key: 'left',  kind: 'wall', size: [D, H], pos: [-W / 2, H / 2, 0], rot: [0, Math.PI / 2, 0] },
    { key: 'right', kind: 'wall', size: [D, H], pos: [ W / 2, H / 2, 0], rot: [0, -Math.PI / 2, 0] },
    { key: 'floor', kind: 'flat', size: [W, D], pos: [0, 0, 0],          rot: [-Math.PI / 2, 0, 0] },
    { key: 'roof',  kind: 'flat', size: [W, D], pos: [0, H, 0],          rot: [ Math.PI / 2, 0, 0] },
  ];
  if (isPoly()) {
    // Every face is one surface; its tiles are the face polygon split into level² triangles.
    return polyhedron(shape, W, N).faces.map((f, i) => ({ key: 'face' + i, kind: 'face', pts: f.pts, pos: [f.c.x, f.c.y, f.c.z], quat: f.quat }));
  }
  // Prism: N walls in a ring (apothem a), N-gon floor and roof carrying the largest inscribed square grid.
  const a = W / 2, R = a / Math.cos(Math.PI / N), ww = 2 * a * Math.tan(Math.PI / N);
  const out = [];
  let k = 0;
  for (let i = 0; i < N; i++) {
    const phi = i * 2 * Math.PI / N;
    k = Math.max(k, Math.abs(Math.cos(phi)) + Math.abs(Math.sin(phi)));
    out.push({ key: 'wall' + i, kind: 'wall', size: [ww, H], pos: [a * Math.sin(phi), H / 2, -a * Math.cos(phi)], rot: [0, -phi, 0] });
  }
  const sq = 2 * a / k;
  out.push({ key: 'floor', kind: 'flat', size: [sq, sq], pos: [0, 0, 0], rot: [-Math.PI / 2, 0, 0], poly: { R, N, start: Math.PI / 2 + Math.PI / N } });
  out.push({ key: 'roof',  kind: 'flat', size: [sq, sq], pos: [0, H, 0], rot: [ Math.PI / 2, 0, 0], poly: { R, N, start: -Math.PI / 2 + Math.PI / N } });
  return out;
}

// ---- Polyhedra: regular solids standing on one face, floor at y = 0, "across" = twice the floor face's inradius ----
const PHI = (1 + Math.sqrt(5)) / 2;
function polyVertices(kind, n) {
  const V = [];
  const add = (x, y, z) => V.push(new THREE.Vector3(x, y, z));
  const signs = [-1, 1];
  if (kind === 'trap') {
    // n-trapezohedron: two apexes and a zigzag ring of 2n vertices (radius 1, height ±z0). The apex height
    // that makes each kite planar is h = z0 (1 + r) / (1 - r) with r = cos(π/n); z0 is chosen so every vertex
    // lies on one sphere, which gives the roundest room.
    const r = Math.cos(Math.PI / n), z0 = (1 - r) / (2 * Math.sqrt(r)), h = z0 * (1 + r) / (1 - r);
    add(0, h, 0); add(0, -h, 0);
    for (let k = 0; k < 2 * n; k++) { const th = k * Math.PI / n; add(Math.cos(th), k % 2 ? -z0 : z0, Math.sin(th)); }
    return V;
  }
  if (kind === 'tetra') { add(1, 1, 1); add(1, -1, -1); add(-1, 1, -1); add(-1, -1, 1); }
  else if (kind === 'octa') { for (const s of signs) { add(s, 0, 0); add(0, s, 0); add(0, 0, s); } }
  else if (kind === 'dodeca') {
    for (const a of signs) for (const b of signs) for (const c of signs) add(a, b, c);
    for (const a of signs) for (const b of signs) { add(0, a / PHI, b * PHI); add(a / PHI, b * PHI, 0); add(a * PHI, 0, b / PHI); }
  } else { // icosahedron, optionally subdivided into a geodesic sphere
    for (const a of signs) for (const b of signs) { add(0, a, b * PHI); add(a, b * PHI, 0); add(b * PHI, 0, a); }
    if (kind === 'geo2') {
      const faces = hullFaces(V);
      const seen = new Map();
      const keep = v => { v.normalize(); const k = v.toArray().map(x => x.toFixed(5)).join(','); if (!seen.has(k)) seen.set(k, v); };
      for (const v of V) keep(v.clone());
      for (const f of faces) for (let i = 0; i < 3; i++) keep(f.verts[i].clone().add(f.verts[(i + 1) % 3]));
      return [...seen.values()];
    }
  }
  return V;
}
// Convex hull of a small symmetric vertex set: planes through three vertices with every other vertex on one side.
function hullFaces(V) {
  const faces = [], n = V.length, e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    const nrm = e1.subVectors(V[j], V[i]).cross(e2.subVectors(V[k], V[i]));
    if (nrm.lengthSq() < 1e-12) continue;
    nrm.normalize();
    const d = nrm.dot(V[i]);
    let pos = 0, neg = 0; const on = [];
    for (let m = 0; m < n; m++) { const t = nrm.dot(V[m]) - d; if (t > 1e-6) pos++; else if (t < -1e-6) neg++; else on.push(m); }
    if (pos && neg) continue;
    const out = pos ? nrm.clone().negate() : nrm.clone(), dist = pos ? -d : d;
    if (faces.some(f => f.n.dot(out) > 0.9999)) continue;
    faces.push({ n: out, dist, verts: on.map(m => V[m]) });
  }
  return faces;
}
const polyCache = {};
function polyhedron(kind, across, n) {
  const ck = kind + ':' + across + ':' + n;
  if (polyCache[ck]) return polyCache[ck];
  let V = polyVertices(kind, n);
  let faces = hullFaces(V);
  // Stand on face 0: rotate its outward normal to -y, then turn so one floor edge runs along x.
  const q = new THREE.Quaternion().setFromUnitVectors(faces[0].n.clone(), new THREE.Vector3(0, -1, 0));
  for (const v of V) v.applyQuaternion(q);
  faces = hullFaces(V);
  const floor = faces.reduce((a, f) => f.n.y < a.n.y ? f : a);
  const e = floor.verts[1].clone().sub(floor.verts[0]);
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(e.z, e.x));
  for (const v of V) v.applyQuaternion(qy);
  faces = hullFaces(V);
  const fl = faces.reduce((a, f) => f.n.y < a.n.y ? f : a);
  const scale = (across / 2) / fl.dist;
  for (const v of V) v.multiplyScalar(scale).y += across / 2;
  const centre = new THREE.Vector3(0, across / 2, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const out = faces.map(f => {
    f.dist *= scale;
    const c = f.verts.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / f.verts.length);
    const nin = f.n.clone().negate();
    let u = new THREE.Vector3().crossVectors(up, nin);
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0); else u.normalize();
    const v = new THREE.Vector3().crossVectors(nin, u);        // "up" along the face
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, nin));
    const pts = f.verts.map(p => { const d = p.clone().sub(c); return [d.dot(u), d.dot(v)]; });
    pts.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));   // counter-clockwise seen from inside
    return { n: f.n, dist: f.dist, c, quat, pts };
  });
  const top = Math.max(...V.map(v => v.y));
  return polyCache[ck] = { faces: out, centre, top };
}
// ---- Even splits: any convex polygon into n equal-area pieces ----
// Rectangles become n cells in rows (row counts chosen so cells are closest to 16:9); anything else becomes n
// blades fanning from the centroid, cut by area while walking the boundary from vertex 0.
function isRect(poly) {
  if (poly.length !== 4) return false;
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return poly.every(p => (Math.abs(p[0] - x0) < 1e-6 || Math.abs(p[0] - x1) < 1e-6) && (Math.abs(p[1] - y0) < 1e-6 || Math.abs(p[1] - y1) < 1e-6));
}
function cutPolygon(poly, n) { return n <= 1 ? [poly] : isRect(poly) ? gridCut(poly, n) : fanCut(poly, n); }
function gridCut(rect, n) {
  const xs = rect.map(p => p[0]), ys = rect.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), w = x1 - x0, h = y1 - y0;
  const counts = r => Array.from({ length: r }, (_, i) => Math.floor(n / r) + (i < n % r ? 1 : 0));
  let best = 1, bestScore = Infinity;
  for (let r = 1; r <= n; r++) {   // worst cell's distance from 16:9 (in log aspect), smaller row count wins ties
    const score = Math.max(...counts(r).map(k => Math.abs(Math.log((w / k) / (h * k / n) / (16 / 9)))));
    if (score < bestScore - 0.05) { best = r; bestScore = score; }   // near-ties go to fewer rows (2 = side by side)
  }
  const out = []; let y = y1;
  for (const k of counts(best)) {
    const rh = h * k / n, cw = w / k;
    for (let i = 0; i < k; i++) { const cx0 = x0 + i * cw; out.push([[cx0, y - rh], [cx0 + cw, y - rh], [cx0 + cw, y], [cx0, y]]); }
    y -= rh;
  }
  return out;
}
function fanCut(polyIn, n) {
  const poly = polyArea(polyIn) < 0 ? polyIn.slice().reverse() : polyIn;
  const c = polyCentroid(poly), m = poly.length, A = polyArea(poly), target = A / n;
  const tri = (a, b) => ((a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1])) / 2;
  const out = []; let cur = [c, poly[0]], acc = 0, k = 1;
  for (let i = 0; i < m; i++) {
    let a = poly[i]; const b = poly[(i + 1) % m];
    let seg = tri(a, b);
    while (k < n && acc + seg >= k * target - 1e-12) {
      const need = k * target - acc, t = seg > 1e-12 ? Math.min(1, need / seg) : 1;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      cur.push(p); out.push(cur); cur = [c, p];
      acc += need; seg -= need; a = p; k++;
    }
    acc += seg; cur.push(b);
  }
  out.push(cur);
  return out.map(w => w.filter((p, i) => i === 0 || Math.hypot(p[0] - w[i - 1][0], p[1] - w[i - 1][1]) > 1e-9)).filter(w => w.length >= 3);
}
function polyCentroid(pts) { const c = [0, 0]; for (const p of pts) { c[0] += p[0] / pts.length; c[1] += p[1] / pts.length; } return c; }
function shapeGeometry(pts) {   // pts centred on the piece's centroid, counter-clockwise
  const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  return new THREE.ShapeGeometry(sh);
}
// Sutherland–Hodgman clip of a convex polygon against the half-plane f(p) >= 0.
function clipHalf(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
// Fit the video onto a polygon tile. The video rectangle (at the video's aspect) is centred on the piece's
// bounding box and grown towards covering it, but never so far that more than "max crop" % of its width or
// height is cut off. Whatever the rectangle does not reach is either left blank (the mesh is clipped to the
// rectangle, the dark backing shows) or filled with mirrored repeats of the video.
// Is p inside the convex counter-clockwise polygon?
function insidePoly(poly, p) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < -1e-9) return false;
  }
  return true;
}
// Largest rectangle of the given aspect that fits entirely inside the polygon: grid of centres, bisection on size.
function inscribedRect(poly, aspect, G = 24) {
  let sa = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; sa += a[0] * b[1] - b[0] * a[1]; }
  if (sa < 0) poly = poly.slice().reverse();   // insidePoly wants counter-clockwise
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const fits = (cx, cy, w) => { const h = w / aspect; return insidePoly(poly, [cx - w / 2, cy - h / 2]) && insidePoly(poly, [cx + w / 2, cy - h / 2]) && insidePoly(poly, [cx + w / 2, cy + h / 2]) && insidePoly(poly, [cx - w / 2, cy + h / 2]); };
  let best = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: 0 };
  const wMax = Math.max(x1 - x0, (y1 - y0) * aspect);
  for (let i = 1; i < G; i++) for (let j = 1; j < G; j++) {
    const cx = x0 + (x1 - x0) * i / G, cy = y0 + (y1 - y0) * j / G;
    if (!insidePoly(poly, [cx, cy]) || !fits(cx, cy, best.w)) continue;
    let lo = best.w, hi = wMax;
    for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (fits(cx, cy, mid)) lo = mid; else hi = mid; }
    if (lo > best.w) best = { cx, cy, w: lo };
  }
  return best;
}
function computeFit(tile, aspect) {
  if (!tile.poly || !aspect) return null;
  const xs = tile.poly.map(p => p[0]), ys = tile.poly.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const bw = x1 - x0, bh = y1 - y0, bx = (x0 + x1) / 2, by = (y0 + y1) / 2;
  const cover = Math.max(bw, bh * aspect);
  if (!tile.insCache || tile.insCache.aspect !== aspect) tile.insCache = { aspect, ins: inscribedRect(tile.poly, aspect) };
  const ins = tile.insCache.ins;                          // zoom 1: the whole video is on the face
  const coverRatio = Math.max(1, cover / ins.w);          // zoom at which the face is fully covered
  const crop = Math.max(0, Math.min(1, (+$('maxCrop').value || 0) / 100));
  const zoomDefault = crop >= 1 ? coverRatio : Math.min(coverRatio, 1 / (1 - crop));
  const view = tile.view;                                 // { zoom|null, dx, dy }: a screen the user has adjusted
  const zoom = view && view.zoom != null ? view.zoom : zoomDefault;
  const vw = ins.w * zoom, vh = vw / aspect;
  // slide the centre from the inscribed rectangle's towards the bounding box's as the video grows, add the pan,
  // and never let a video edge pass the face centre
  const t = coverRatio > 1 ? Math.max(0, Math.min(1, (zoom - 1) / (coverRatio - 1))) : 1;
  let cx = ins.cx + (bx - ins.cx) * t + (view ? view.dx * vw : 0), cy = ins.cy + (by - ins.cy) * t + (view ? view.dy * vh : 0);
  cx = Math.max(bx - vw / 2, Math.min(bx + vw / 2, cx)); cy = Math.max(by - vh / 2, Math.min(by + vh / 2, cy));
  tile.fit = { vw, vh, cx, cy, coverRatio, zoomDefault };
  // Regions of the face, each showing the video mapped to its own rectangle { poly, cx, cy, vw, vh }.
  const mode = $('fillMode').value, rect = { cx, cy, vw, vh };
  const regions = [], mirrors = [];
  if (mode === 'mirror') { const r = { poly: tile.poly, ...rect }; regions.push(r); mirrors.push(r); }
  else {
    const main = clipToRect(tile.poly, rect);
    regions.push({ poly: main.length >= 3 ? main : tile.poly, ...rect });
    if (mode === 'nested' && main.length >= 3) {
      const depth = Math.max(1, Math.min(4, +$('nestDepth').value || 2)), inc = Math.max(0, (+$('nestInc').value || 0) / 100);
      const fallback = $('nestFallback').value, flip = $('nestFlip').checked;
      for (const piece of leftoverPieces(tile.poly, rect)) nestFill(piece, rect, 1, { aspect, crop, inc, depth, fallback, flip, minW: Math.max(NEST_MIN_W, NEST_MIN_FRAC * vw) }, regions, mirrors);
    }
  }
  return { regions, mirrors };
}
function fitTile(tile, aspect) {
  const f = computeFit(tile, aspect); if (!f) return;
  tile.regions = f.regions; tile.mirrors = f.mirrors;
  applyTileGeometry(tile);
}
// Rebuild the tile mesh from its regions. While a sector wipe is running (tile.wipe) every region is clipped
// to the sector revealed so far, so the video stays pinned in place and only the window onto it grows.
function applyTileGeometry(tile) {
  let { regions, mirrors } = tile;
  const w = tile.wipe;
  if (w) {
    const a1 = w.a1, a0 = a1 - w.span * w.e;
    const clip = list => list.flatMap(r => clipSector(r.poly, w.pivot, a0, a1).map(poly => ({ ...r, poly })));
    regions = clip(regions); mirrors = clip(mirrors);
  }
  tile.mesh.geometry.dispose();
  tile.mesh.geometry = regionsGeometry(regions);
  tile.mesh.visible = regions.length > 0;
  updateSeams(tile, mirrors);
}
// Angular span of a convex polygon as seen from a pivot (both in the same 2D frame): the sector from a1 - span
// to a1. A pivot inside the polygon means a full turn, ending at 12 o'clock.
function sectorOf(poly, pv) {
  const strictlyInside = poly.every((a, i) => { const b = poly[(i + 1) % poly.length]; return (b[0] - a[0]) * (pv[1] - a[1]) - (b[1] - a[1]) * (pv[0] - a[0]) > 1e-4; });
  if (strictlyInside) return { a1: Math.PI / 2, span: 2 * Math.PI };
  const pts = poly.filter(p => Math.hypot(p[0] - pv[0], p[1] - pv[1]) > 1e-6);
  if (!pts.length) return { a1: Math.PI / 2, span: 2 * Math.PI };
  const ref = Math.atan2(pts[0][1] - pv[1], pts[0][0] - pv[0]);
  let lo = 0, hi = 0;
  for (const p of pts) { let d = Math.atan2(p[1] - pv[1], p[0] - pv[0]) - ref; d = Math.atan2(Math.sin(d), Math.cos(d)); lo = Math.min(lo, d); hi = Math.max(hi, d); }
  return { a1: ref + hi, span: hi - lo };
}
// Convex polygon ∩ sector [a0, a1] around pv, as a list of convex pieces (the sector is cut into ≤ 150° wedges).
function clipSector(poly, pv, a0, a1) {
  const out = [], n = Math.max(1, Math.ceil((a1 - a0) / (Math.PI * 5 / 6)));
  if (a1 - a0 <= 1e-6) return out;
  for (let i = 0; i < n; i++) {
    const b0 = a0 + (a1 - a0) * i / n, b1 = a0 + (a1 - a0) * (i + 1) / n;
    let p = clipHalf(poly, q => Math.cos(b0) * (q[1] - pv[1]) - Math.sin(b0) * (q[0] - pv[0]));   // left of the ray at b0
    p = clipHalf(p, q => Math.sin(b1) * (q[0] - pv[0]) - Math.cos(b1) * (q[1] - pv[1]));          // right of the ray at b1
    if (p.length >= 3) out.push(p);
  }
  return out;
}
// Polygon ∩ rectangle, and the (up to four) convex pieces of polygon outside the rectangle.
function clipToRect(poly, r) {
  let p = clipHalf(poly, q => q[0] - (r.cx - r.vw / 2));
  p = clipHalf(p, q => (r.cx + r.vw / 2) - q[0]);
  p = clipHalf(p, q => q[1] - (r.cy - r.vh / 2));
  return clipHalf(p, q => (r.cy + r.vh / 2) - q[1]);
}
function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return a / 2; }
function leftoverPieces(poly, r) {
  const x0 = r.cx - r.vw / 2, x1 = r.cx + r.vw / 2, y0 = r.cy - r.vh / 2, y1 = r.cy + r.vh / 2;
  const band = clipHalf(clipHalf(poly, q => q[0] - x0), q => x1 - q[0]);
  const pieces = [clipHalf(poly, q => x0 - q[0]), clipHalf(poly, q => q[0] - x1), clipHalf(band, q => q[1] - y1), clipHalf(band, q => y0 - q[1])];
  pieces.forEach((p, i) => p.side = i < 2 ? 'x' : 'y');   // beside the rectangle, or above/below it
  return pieces.filter(p => p.length >= 3 && polyArea(p) > 1e-6);
}
// Nested copies: fit a smaller copy of the video into a leftover piece (same rule as the face, more crop per level),
// then recurse into that piece's own leftovers. Pieces too small or too slim get the fallback: mirrored continuation
// of the enclosing video (with seam lines) or blank.
const NEST_MIN_W = 0.12, NEST_MIN_FRAC = 0.2, NEST_MAX_SLIM = 4;   // min copy width (m, fraction of main), max piece bbox aspect
// With o.flip, a copy beside its parent is mirrored horizontally and one above/below it vertically, relative to
// the parent's own orientation, so each level flips again (region fx / fy).
function nestFill(piece, parent, level, o, regions, mirrors) {
  const fallback = () => { if (o.fallback === 'mirror') { const r = { poly: piece, cx: parent.cx, cy: parent.cy, vw: parent.vw, vh: parent.vh, fx: parent.fx, fy: parent.fy }; regions.push(r); mirrors.push(r); } };
  if (level > o.depth) return fallback();
  const xs = piece.map(p => p[0]), ys = piece.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const bw = x1 - x0, bh = y1 - y0, bx = (x0 + x1) / 2, by = (y0 + y1) / 2;
  if (bw < 1e-6 || bh < 1e-6 || Math.max(bw / bh, bh / bw) > NEST_MAX_SLIM) return fallback();   // a sliver
  const ins = inscribedRect(piece, o.aspect, 12);
  if (ins.w <= 0) return fallback();
  const cover = Math.max(bw, bh * o.aspect), coverRatio = Math.max(1, cover / ins.w);
  const crop = Math.min(1, o.crop + o.inc * level);
  const zoom = crop >= 1 ? coverRatio : Math.min(coverRatio, 1 / (1 - crop));
  const vw = ins.w * zoom, vh = vw / o.aspect;
  if (vw < o.minW) return fallback();                                     // too small to read
  const t = coverRatio > 1 ? Math.max(0, Math.min(1, (zoom - 1) / (coverRatio - 1))) : 1;
  const rect = { cx: ins.cx + (bx - ins.cx) * t, cy: ins.cy + (by - ins.cy) * t, vw, vh, fx: !!parent.fx, fy: !!parent.fy };
  if (o.flip) { if (piece.side === 'x') rect.fx = !rect.fx; else rect.fy = !rect.fy; }
  const main = clipToRect(piece, rect);
  if (main.length < 3) return fallback();
  regions.push({ poly: main, ...rect });
  for (const sub of leftoverPieces(piece, rect)) nestFill(sub, rect, level + 1, o, regions, mirrors);
}
// One geometry for all regions: each region's polygon with UVs mapped to its own rectangle.
function regionsGeometry(regions) {
  const pos = [], uv = [], idx = [];
  for (const r of regions) {
    if (r.poly.length < 3) continue;
    const g = shapeGeometry(r.poly), p = g.attributes.position, ix = g.index, base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), 0);
      const u = (p.getX(i) - r.cx) / r.vw + 0.5, v = (p.getY(i) - r.cy) / r.vh + 0.5;
      uv.push(r.fx ? 1 - u : u, r.fy ? 1 - v : v);
    }
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
// Mirror mode: subtle lines where the video starts repeating, so the reflections read as reflections.
const SEAM_W = 0.008;
const seamMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });
function clipSegment(a, b, poly) {   // part of segment a-b inside the convex counter-clockwise polygon, or null
  let t0 = 0, t1 = 1;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], ex = q[0] - p[0], ey = q[1] - p[1];
    const fa = ex * (a[1] - p[1]) - ey * (a[0] - p[0]), fb = ex * (b[1] - p[1]) - ey * (b[0] - p[0]);
    if (fa < 0 && fb < 0) return null;
    if (fa < 0) t0 = Math.max(t0, fa / (fa - fb)); else if (fb < 0) t1 = Math.min(t1, fa / (fa - fb));
    if (t0 >= t1) return null;
  }
  return [[a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]];
}
function updateSeams(tile, mirrors) {
  if (tile.isFloat) return;
  const lines = [];   // [a, b, poly]: a seam segment and the region polygon it is clipped to
  for (const r of mirrors) {
    const xs = r.poly.map(p => p[0]), ys = r.poly.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    for (let k = 0; k < 6; k++) {
      for (const sx of [r.cx - (k + 0.5) * r.vw, r.cx + (k + 0.5) * r.vw]) if (sx > x0 && sx < x1) lines.push([[sx, y0 - 1], [sx, y1 + 1], r.poly]);
      for (const sy of [r.cy - (k + 0.5) * r.vh, r.cy + (k + 0.5) * r.vh]) if (sy > y0 && sy < y1) lines.push([[x0 - 1, sy], [x1 + 1, sy], r.poly]);
    }
  }
  const pos = [], idx = [];
  for (const [a, b, poly] of lines) {
    const seg = clipSegment(a, b, poly); if (!seg) continue;
    const [p, q] = seg, dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy); if (L < 1e-6) continue;
    const nx = -dy / L * SEAM_W / 2, ny = dx / L * SEAM_W / 2, base = pos.length / 3;
    pos.push(p[0] - nx, p[1] - ny, 0, q[0] - nx, q[1] - ny, 0, q[0] + nx, q[1] + ny, 0, p[0] + nx, p[1] + ny, 0);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  if (!tile.seam) {
    tile.seam = new THREE.Mesh(new THREE.BufferGeometry(), seamMat);
    tile.seam.position.copy(tile.mesh.position); tile.seam.position.z = 0.002; tile.seam.renderOrder = 2;
    tile.mesh.parent.add(tile.seam);
  }
  tile.seam.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  tile.seam.geometry = g;
  tile.seam.visible = idx.length > 0;
}
const fitPolyUV = fitTile;
function refitTile(t) { if (t.poly) fitTile(t, t.video && t.video.videoWidth ? t.video.videoWidth / t.video.videoHeight : 16 / 9); }
function refitAll() { for (const t of tiles) refitTile(t); }
function resetView(t) { if (t.isFloat) t = t.origin; if (!t) return; t.view = null; refitTile(t); }

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
// ---- Hover HUD: the screen's contour is its progress bar; a sound icon floats in front of it ----
const RING_W = 0.025, RING_SEGS = 160;
const RING_ON = new THREE.Color(0x6fc3ff), RING_OFF = new THREE.Color(0x24507a);
const ringMat = new THREE.MeshBasicMaterial({ vertexColors: true });
// Ring of quads around a convex outline (counter-clockwise points), ordered clockwise from the top-left corner
// so that lighting the first k segments draws playback progress.
function makeRing(outline, width) {
  const n = outline.length;
  let start = 0, best = -Infinity;
  outline.forEach((p, i) => { const sc = p[1] - p[0]; if (sc > best) { best = sc; start = i; } });
  const pts = []; for (let k = 0; k < n; k++) pts.push(outline[(start - k + n) % n]);   // reversed = clockwise
  const edges = []; let per = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]); edges.push({ a, b, L }); per += L; }
  const pos = [], col = [], idx = []; let segs = 0;
  for (const e of edges) {
    const dx = (e.b[0] - e.a[0]) / e.L, dy = (e.b[1] - e.a[1]) / e.L, nx = -dy, ny = dx;   // outward for a clockwise polygon
    const m = Math.max(1, Math.round(e.L / per * RING_SEGS));
    for (let j = 0; j < m; j++) {
      const l0 = e.L * j / m + (j === 0 ? -width : 0), l1 = e.L * (j + 1) / m + (j === m - 1 ? width : 0);   // overlap the corners
      const x0 = e.a[0] + dx * l0, y0 = e.a[1] + dy * l0, x1 = e.a[0] + dx * l1, y1 = e.a[1] + dy * l1;
      const b = pos.length / 3;
      pos.push(x0, y0, 0, x1, y1, 0, x1 + nx * width, y1 + ny * width, 0, x0 + nx * width, y0 + ny * width, 0);
      for (let k = 0; k < 4; k++) col.push(RING_OFF.r, RING_OFF.g, RING_OFF.b);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      segs++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, ringMat);
  mesh.userData.segs = segs; mesh.userData.lit = -1;
  return mesh;
}
function setRingProgress(ring, progress) {
  const n = ring.userData.segs, lit = Math.round(Math.max(0, Math.min(1, progress)) * n);
  if (lit === ring.userData.lit) return;
  ring.userData.lit = lit;
  const c = ring.geometry.attributes.color;
  for (let i = 0; i < n; i++) { const k = i < lit ? RING_ON : RING_OFF; for (let v = 0; v < 4; v++) c.setXYZ(i * 4 + v, k.r, k.g, k.b); }
  c.needsUpdate = true;
}
// Sound icon: speaker (green = audible, grey with red cross = muted), pause bars when paused.
const ICON_DEG = 2.6, ICON_LIFT = 0.06;   // apparent size (degrees) and how far it floats in front of the surface (m)
const iconMats = {};
function iconMaterial(audible, paused, top = false, liked = false, pinned = false) {
  const key = (audible ? 'a' : 'm') + (paused ? 'p' : '') + (top ? 't' : '') + (liked ? 'l' : '') + (pinned ? 'n' : '');
  if (iconMats[key]) return iconMats[key];
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(0,0,0,0.55)'; c.beginPath(); c.arc(64, 64, 60, 0, Math.PI * 2); c.fill();
  c.fillStyle = audible ? '#4aff8a' : '#aaa';
  c.beginPath(); c.moveTo(30, 50); c.lineTo(48, 50); c.lineTo(70, 30); c.lineTo(70, 98); c.lineTo(48, 78); c.lineTo(30, 78); c.closePath(); c.fill();
  c.lineWidth = 6; c.lineCap = 'round';
  if (audible) { c.strokeStyle = '#4aff8a'; c.beginPath(); c.arc(74, 64, 18, -0.9, 0.9); c.stroke(); c.beginPath(); c.arc(74, 64, 30, -0.9, 0.9); c.stroke(); }
  else { c.strokeStyle = '#f55'; c.beginPath(); c.moveTo(80, 50); c.lineTo(106, 78); c.moveTo(106, 50); c.lineTo(80, 78); c.stroke(); }
  if (paused) { c.fillStyle = '#ffd24a'; c.fillRect(84, 86, 10, 30); c.fillRect(100, 86, 10, 30); }
  if (liked) {   // small heart, bottom-left
    c.fillStyle = '#ff4a6a'; c.beginPath();
    c.moveTo(36, 112); c.bezierCurveTo(14, 96, 18, 72, 36, 80); c.bezierCurveTo(54, 72, 58, 96, 36, 112); c.fill();
  }
  if (pinned) {  // small pin, top-right: head + needle
    c.fillStyle = '#ffd24a'; c.beginPath(); c.arc(100, 28, 11, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#ffd24a'; c.lineWidth = 5; c.beginPath(); c.moveTo(100, 38); c.lineTo(100, 60); c.stroke();
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return iconMats[key] = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: !top });
}
function makeIcon() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), iconMaterial(false, false));
  m.visible = false; m.renderOrder = 9;
  return m;
}
const highlightMat = new THREE.MeshBasicMaterial({ color: 0x4aa8ff });
const roomGroup = new THREE.Group();
scene.add(roomGroup);

let tiles = [];           // [{ mesh, w, h, video, label, highlight }]
let sources = [];         // [{ src, label }]
let videoEls = [];        // all live <video> elements
const tileOf = new Map(); // mesh -> tile

let layouts = {};          // surface key -> root node { poly, children: [node], parent, tile? }; a node with no children is one screen
const surfaceGroups = {};  // surface key -> THREE.Group
const leafNode = parent => ({ poly: null, children: [], parent, tile: null });
const leavesOf = n => n.children.length ? n.children.flatMap(leavesOf) : [n];
function rebuildNode(n) {   // recompute the polygons of a subtree from n.poly
  if (!n.children.length) return;
  const polys = cutPolygon(n.poly, n.children.length);
  n.children.forEach((c, i) => { c.poly = polys[i]; c.parent = n; rebuildNode(c); });
}
function underNode(n, anc) { for (; n; n = n.parent) if (n === anc) return true; return false; }
function surfacePoly(s) {
  if (s.kind === 'face') return s.pts;
  if (s.poly) { const { R, N: k, start } = s.poly; return Array.from({ length: k }, (_, i) => [R * Math.cos(start + i * 2 * Math.PI / k), R * Math.sin(start + i * 2 * Math.PI / k)]); }
  const [w, h] = s.size; return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
}
function startCount(s) { return Math.max(1, Math.min(64, +$(s.kind === 'face' ? 'faceN' : s.kind === 'wall' ? 'wallN' : 'flatN').value || 1)); }

function buildSurface(s) {
  const bezel = $('bezel').checked ? 0.03 : 0;
  const g = new THREE.Group();
  g.position.set(...s.pos);
  if (s.quat) g.quaternion.copy(s.quat); else g.rotation.set(...s.rot);
  roomGroup.add(g);
  surfaceGroups[s.key] = g;
  if (s.kind === 'face') { const back = new THREE.Mesh(shapeGeometry(s.pts), bezelMat); back.position.z = -0.006; g.add(back); }
  else if (s.poly) {   // polygon floor/roof: always backed so the corners outside the grid look closed
    const back = new THREE.Mesh(new THREE.CircleGeometry(s.poly.R, s.poly.N, s.poly.start), bezelMat);
    back.position.z = -0.006;
    g.add(back);
  } else if (bezel) {
    const back = new THREE.Mesh(new THREE.PlaneGeometry(...s.size), bezelMat);
    back.position.z = -0.006;
    g.add(back);
  }
  let root = layouts[s.key];
  if (!root) {
    root = { poly: surfacePoly(s), children: [], parent: null, tile: null };
    const n0 = startCount(s);
    if (n0 > 1) root.children = Array.from({ length: n0 }, () => leafNode(root));
    layouts[s.key] = root;
  }
  rebuildNode(root);
  return leavesOf(root).map(L => makeLeafTile(L, g, bezel, s.key));
}

// One screen for a leaf of the layout tree: polygon mesh centred on its centroid, inset by the bezel.
function makeLeafTile(L, g, bezel, key) {
  const c = polyCentroid(L.poly);
  let pts = L.poly.map(p => [p[0] - c[0], p[1] - c[1]]);
  if (polyArea(pts) < 0) pts.reverse();
  if (isRect(pts)) {   // exact inset, so neighbouring cells are a full bezel apart
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const hw = Math.max(0.02, Math.max(...xs) - bezel / 2), hh = Math.max(0.02, Math.max(...ys) - bezel / 2);
    pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  } else {             // scale about the centroid by a rough inradius
    const inr = Math.sqrt(polyArea(pts) / 2 / Math.PI);
    const k = Math.max(0.5, 1 - bezel / Math.max(inr, 0.05));
    pts = pts.map(p => [p[0] * k, p[1] * k]);
  }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const m = new THREE.Mesh(shapeGeometry(pts), placeholder);
  m.position.set(c[0], c[1], 0);
  g.add(m);
  const hit = new THREE.Mesh(shapeGeometry(pts), placeholder);   // full piece: shows where the video is clipped, and catches the beam there
  hit.position.copy(m.position); hit.position.z = -0.001;
  g.add(hit);
  const hl = makeRing(pts, RING_W);
  hl.position.copy(m.position); hl.position.z = -0.003; hl.visible = false;
  g.add(hl);
  const icon = makeIcon(); icon.position.copy(m.position); g.add(icon);
  const tile = { mesh: m, w, h, video: null, label: '', highlight: hl, icon, surface: key, poly: pts, outline: pts, hit, shapePts: pts, node: L };
  L.tile = tile;
  fitTile(tile, 16 / 9);
  tiles.push(tile); tileOf.set(m, tile); tileOf.set(hit, tile);
  return tile;
}

function buildLayout() {
  unfocus(true);
  disposeVideos();
  setFocus(null);
  for (const h of hands) h.hovered = null;
  mouseTile = null;
  roomGroup.clear();
  tiles = []; tileOf.clear();
  shape = $('shape').value; N = Math.max(3, Math.min(shape === 'trap' ? 16 : 48, +$('prismN').value || 6));
  W = +$('roomW').value || 5; D = shape === 'box' ? (+$('roomD').value || 5) : W; H = +$('roomH').value || 3;
  polyCentreY = 0;
  if (isPoly()) { const ph = polyhedron(shape, W, N); H = ph.top; polyCentreY = ph.centre.y; $('roomH').value = H.toFixed(1); }
  roomScale = 1; roomGroup.scale.setScalar(1); roomGroup.position.set(0, 0, 0); roomGroup.quaternion.identity();
  layouts = {};
  for (const s of surfaces()) buildSurface(s);
  updateTileCount();
  if (library.length) dealRandom(); else applySources();
}
function updateTileCount() {
  const dims = shape === 'prism' ? `${N} walls, ${(W * roomScale).toFixed(1)} m across × ${(H * roomScale).toFixed(1)} m high`
             : isPoly()          ? `${surfaces().length} faces, ${(W * roomScale).toFixed(1)} m across × ${(H * roomScale).toFixed(1)} m high`
                                 : `${(W * roomScale).toFixed(1)} × ${(D * roomScale).toFixed(1)} × ${(H * roomScale).toFixed(1)} m`;
  $('tileCount').textContent = `${tiles.length} screens · ${dims}`;
}

// ---- Layout actions on one screen: add a sibling, remove this piece, split this piece ----
// Only the changed container's subtree is rebuilt; its surviving screens keep their videos (and per-screen
// view), a split piece's video goes to its first child, new pieces are dealt, and everything sweeps in about
// the container's centre.
async function layoutAction(tile, act) {
  const t = tile.isFloat ? tile.origin : tile; if (!t || !t.node) return;
  const node = t.node, p = node.parent;
  let changed;
  if (act === 'split' || (act === 'add' && !p)) { node.children = [leafNode(node), leafNode(node)]; changed = node; }
  else if (act === 'add') { p.children.push(leafNode(p)); changed = p; }
  else if (act === 'remove') {
    if (!p) return;
    if (isPinnedKey(t.label)) { setStatus('Pinned videos stay up: unpin it first.'); return; }
    p.children = p.children.filter(c => c !== node);
    if (p.children.length === 1) {   // a group of one dissolves into its parent
      const only = p.children[0];
      p.children = only.children; for (const c of p.children) c.parent = p;
      p.tile = only.tile;
    }
    changed = p;
  }
  if (changed) await restructure(t.surface, changed);
}
async function restructure(key, node) {
  unfocus(true); setFocus(null);
  for (const h of hands) h.hovered = null;
  mouseTile = null;
  rebuildNode(node);
  const leaves = leavesOf(node);
  const old = tiles.filter(t => t.surface === key && underNode(t.node, node));
  // which old screen each new leaf inherits: its own, or its parent's when that parent was just split
  const inherit = new Map();
  for (const L of leaves) {
    if (L.tile && old.includes(L.tile)) inherit.set(L, L.tile);
    else if (L.parent && L.parent.tile && old.includes(L.parent.tile) && L === L.parent.children[0]) inherit.set(L, L.parent.tile);
  }
  for (const L of leaves) L.tile = null;
  for (let n = node; n; n = n.parent) if (n.children.length) n.tile = null;
  for (const t of old) { cancelTransition(t); tileOf.delete(t.mesh); if (t.hit) tileOf.delete(t.hit); }
  tiles = tiles.filter(t => !old.includes(t));
  const prev = ghosts.find(g => g.key === key); if (prev) dropGhost(prev);
  const g = surfaceGroups[key], bezel = $('bezel').checked ? 0.03 : 0;
  const made = leaves.map(L => makeLeafTile(L, g, bezel, key));
  const parts = t => [t.mesh, t.hit, t.highlight, t.icon, t.seam].filter(Boolean);
  let ghost = null;
  if (transScale() && old.length) {
    // the old screens stay, 4 mm behind, until every new screen has swept in
    const gg = new THREE.Group(); gg.position.z = -0.004; g.add(gg);
    for (const t of old) { gg.add(...parts(t)); t.highlight.visible = false; t.icon.visible = false; }
    for (const t of made) { t.hit.visible = false; t.mesh.visible = false; }
    ghost = { key, group: gg, old, tiles: made, armed: false };
    ghosts.push(ghost);
  } else {
    for (const t of old) { g.remove(...parts(t)); retire(t.video, t.mesh.material); }
  }
  const enter = ghost ? wipeIn(polyCentroid(node.poly)) : popIn;
  const fresh = [];
  leaves.forEach((L, i) => {
    const t = made[i], src = inherit.get(L);
    if (!src || !src.video) { fresh.push(t); return; }
    const mat = src.mesh.material;
    t.video = src.video; t.label = src.label; t.view = src.view ? { ...src.view } : null; t.hist = src.hist;
    enterWith(t, src.video, mat, () => { t.mesh.material = mat; refitTile(t); }, enter);
  });
  if (library.length) {
    const next = makeDealer(new Set(tiles.map(t => t.label)));
    for (const t of fresh) { const e = next(); setTileSource(t, await urlFor(e), e.key, enter); }
  } else if (sources.length) {
    fresh.forEach((t, i) => { const src = sources[i % sources.length]; setTileSource(t, src.src, src.label, enter); });
  }
  if (ghost) ghost.armed = true;
  updateTileCount();
}

// ---- Transitions ----
// A tile's incoming video is held back until it has a frame, then "enters": popIn scales a copy of the tile with
// the new video up over the old one (which keeps playing underneath); wipeIn reveals it in place through a sector
// sweeping about the surface centre. Old videos and materials are retired only when nothing shows them any more.
const TRANS_MS = { pop: 350, wipe: 600 };
const transScale = () => ({ off: 0, quick: 0.5, normal: 1, slow: 2 })[$('transitions').value] ?? 1;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const aspectOf = v => v && v.videoWidth ? v.videoWidth / v.videoHeight : 16 / 9;
let transitions = [];   // [{ tile, video, mat, done, t0?, dur?, ease?, step? }]; t0 unset = waiting for a frame
let ghosts = [];        // [{ key, group, old, tiles, armed }]: a container's previous screens, kept until the new ones are in
function videoInUse(v) { return tiles.some(t => t.video === v) || transitions.some(a => a.video === v) || ghosts.some(g => g.old.some(t => t.video === v)); }
function matInUse(m) { return tiles.some(t => t.mesh.material === m) || transitions.some(a => a.mat === m) || ghosts.some(g => g.old.some(t => t.mesh.material === m)) || floatMesh.material === m; }
function retire(v, m) {
  if (v && !videoInUse(v)) killVideo(v);
  if (m && m !== placeholder && m.map && !matInUse(m)) { m.map.dispose(); m.dispose(); }
}
// Finish a tile's pending transition right now (its final state is applied).
function cancelTransition(tile) {
  const a = tile.trans; if (!a) return;
  tile.trans = null; transitions = transitions.filter(x => x !== a);
  a.done();
}
// Schedule `finish` (which puts mat/video on the tile) to run after the chosen entrance animation.
function enterWith(tile, video, mat, finish, enter = popIn) {
  cancelTransition(tile);
  const a = { tile, video, mat, done: finish };
  transitions.push(a); tile.trans = a;
  if (!transScale() || !tile.poly || focused === tile) { cancelTransition(tile); return; }
  const start = () => { if (tile.trans !== a) return; enter(a, aspectOf(video)); };
  if (video.readyState >= 2) start(); else video.addEventListener('loadeddata', start, { once: true });
}
function popIn(a, aspect) {
  const tile = a.tile, f = computeFit(tile, aspect), fin = a.done;
  const ov = new THREE.Mesh(regionsGeometry(f ? f.regions : []), a.mat);
  ov.position.copy(tile.mesh.position); ov.position.z += 0.003; ov.renderOrder = 3; ov.scale.setScalar(1e-4);
  tile.mesh.parent.add(ov);
  a.t0 = performance.now(); a.dur = TRANS_MS.pop * transScale(); a.ease = easeOut;
  a.step = e => ov.scale.setScalar(Math.max(1e-4, e));
  a.done = () => { if (ov.parent) ov.parent.remove(ov); ov.geometry.dispose(); fin(); };
}
function wipeIn(pivot) {   // pivot in surface-group coordinates
  return (a, aspect) => {
    const tile = a.tile, fin = a.done;
    tile.mesh.material = a.mat;
    const pv = [pivot[0] - tile.mesh.position.x, pivot[1] - tile.mesh.position.y];
    tile.wipe = { pivot: pv, ...sectorOf(tile.poly, pv), e: 0 };
    fitTile(tile, aspect);
    a.t0 = performance.now(); a.dur = TRANS_MS.wipe * transScale(); a.ease = easeInOut;
    a.step = e => { tile.wipe.e = e; applyTileGeometry(tile); };
    a.done = () => { tile.wipe = null; fin(); };
  };
}
function dropGhost(g) {
  ghosts = ghosts.filter(x => x !== g);
  if (g.group.parent) g.group.parent.remove(g.group);
  for (const t of g.old) retire(t.video, t.mesh.material);
  for (const t of g.tiles) if (t.hit) t.hit.visible = true;
}
function dropAllTransitions() { for (const g of ghosts.slice()) dropGhost(g); for (const t of tiles) cancelTransition(t); }
function updateTransitions(now) {
  for (const a of transitions.slice()) {
    if (!a.t0) continue;
    const t = Math.min(1, (now - a.t0) / a.dur);
    a.step(a.ease(t));
    if (t >= 1) cancelTransition(a.tile);
  }
  for (const g of ghosts.slice()) if (g.armed && g.tiles.every(t => !t.trans)) dropGhost(g);
}
$('transitions').addEventListener('change', () => kvSet('transitions', $('transitions').value));

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
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  return new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
}
function killVideo(v) {
  v.pause(); v.removeAttribute('src'); v.load();
  videoEls = videoEls.filter(x => x !== v);
}
function disposeVideos() {
  unfocus(true);
  dropAllTransitions();
  for (const v of videoEls) { v.pause(); v.removeAttribute('src'); v.load(); }
  videoEls = [];
  for (const t of tiles) {
    const mat = t.mesh.material;
    if (mat !== placeholder && mat.map) { mat.map.dispose(); mat.dispose(); }
    t.mesh.material = placeholder; t.video = null; t.label = '';
  }
}
function setTileSource(tile, src, label, enter = popIn, nav = false) {
  if (tile.isFloat) { setTileSource(tile.origin, src, label, enter, nav); syncFloat(); return; }
  cancelTransition(tile);
  if (!nav) pushHist(tile, label);
  const old = tile.video, oldMat = tile.mesh.material, oldLabel = tile.label;
  const v = makeVideo(src), mat = makeMaterial(v);
  tile.video = v; tile.label = label;
  unpinIfGone(oldLabel);
  if (tile.poly) v.addEventListener('loadedmetadata', () => { if (tile.video === v && tile.mesh.material === mat) refitTile(tile); }, { once: true });
  enterWith(tile, v, mat, () => { tile.mesh.material = mat; if (tile.poly) refitTile(tile); retire(old, oldMat); }, enter);
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

// ---- Library: folders (optionally with subfolders) and individual files ----
// Handles are persisted in IndexedDB; Chrome re-grants read access with one click on next launch.
const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov|ogv)$/i;
let roots = [];            // [{ id, kind:'dir'|'files', handle?, handles?, name, sub, granted, entries }]
let library = [];          // flattened entries of granted roots: [{ handle, key, name, url? }]
let rootSeq = 0;
const tileName = label => (label || '').replace(/^\d+:/, '').split('/').pop();

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('video-room', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function kvSet(k, v) { const db = await idb(); const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); return new Promise(r => tx.oncomplete = r); }
async function kvGet(k) { const db = await idb(); return new Promise(r => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(undefined); }); }
async function kvDel(k) { const db = await idb(); const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); return new Promise(r => tx.oncomplete = r); }

// Walks one folder; unreadable subfolders are skipped and counted, never abort the scan.
async function scanDir(dir, sub, prefix, out, stat) {
  stat.dirs++;
  let it;
  try { it = dir.entries(); } catch (e) { stat.failed.push(prefix || dir.name); return; }
  while (true) {
    let step;
    try { step = await it.next(); } catch (e) { stat.failed.push(prefix || dir.name); return; }
    if (step.done) return;
    const [name, h] = step.value;
    if (h.kind === 'file') {
      stat.files++;
      if (VIDEO_EXT.test(name)) out.push({ handle: h, name, rel: prefix + name });
      else { const ext = (name.match(/\.([^.]+)$/) || [, '?'])[1].toLowerCase(); stat.other.set(ext, (stat.other.get(ext) || 0) + 1); }
    } else if (sub && h.kind === 'directory') await scanDir(h, sub, prefix + name + '/', out, stat);
  }
}
async function scanRoot(r) {
  const out = [];
  const stat = { dirs: 0, files: 0, failed: [], other: new Map() };
  if (r.kind === 'dir') await scanDir(r.handle, r.sub, '', out, stat);
  else for (const h of r.handles) if (VIDEO_EXT.test(h.name)) out.push({ handle: h, name: h.name, rel: h.name });
  r.scan = stat;
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  // Keep object URLs of files that are still present (screens may be playing them); drop the rest.
  const prev = new Map(r.entries.map(e => [e.rel, e]));
  for (const e of out) { e.key = `${r.id}:${e.rel}`; e.rootName = r.name; const o = prev.get(e.rel); if (o?.url) { e.url = o.url; prev.delete(e.rel); } }
  for (const o of prev.values()) if (o.url) URL.revokeObjectURL(o.url);
  r.entries = out;
}
function scanSummary(r) {
  const st = r.scan; if (!st) return '';
  const other = [...st.other.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e, n]) => `${n}× .${e}`).join(', ');
  return `Scanned ${st.dirs} folder${st.dirs === 1 ? '' : 's'}, ${st.files} file${st.files === 1 ? '' : 's'}` +
    (other ? ` (other types: ${other})` : '') +
    (st.failed.length ? `; could not read ${st.failed.length}: ${st.failed.slice(0, 3).join(', ')}` : '') + '.';
}
function rebuildLibrary() {
  library = roots.filter(r => r.granted).flatMap(r => r.entries);
  rebuildLikedKeys();
  renderRoots();
}

// ---- Likes: a single playlist of favourite videos, persisted with their file handles ----
let likes = [];            // [{ handle, rootName, rel, name }]
let likedKeys = new Set(); // library keys of liked videos that are currently available
const likeId = e => `${e.rootName}|${e.rel}`;
function rebuildLikedKeys() {
  const ids = new Set(likes.map(likeId));
  likedKeys = new Set(library.filter(e => ids.has(likeId(e))).map(e => e.key));
  const n = likes.length, avail = likedKeys.size;
  $('likeInfo').textContent = n ? `${n} liked${avail < n ? ` (${avail} available)` : ''}` : 'no liked videos yet';
  rebuildPinnedKeys();
  rebuildDismissedKeys();
}
const isLikedKey = key => likedKeys.has(key);
const likedEntries = () => library.filter(e => likedKeys.has(e.key) && !dismissedKeys.has(e.key));
async function persistLikes() { await kvSet('likes', likes.map(l => ({ handle: l.handle, rootName: l.rootName, rel: l.rel, name: l.name }))); }
async function toggleLike(tile) {
  const t = tile.isFloat ? tile.origin : tile; if (!t) return;
  const e = library.find(x => x.key === t.label);
  if (!e) { setStatus('Only library videos can be liked.'); return; }
  const id = likeId(e), i = likes.findIndex(l => likeId(l) === id);
  if (i >= 0) likes.splice(i, 1); else likes.push({ handle: e.handle, rootName: e.rootName, rel: e.rel, name: e.name });
  rebuildLikedKeys();
  await persistLikes();
}
// Put a random liked video (preferably one not already on a screen) on this tile
async function deployLiked(tile) {
  const t = tile.isFloat ? tile.origin : tile; if (!t) return;
  const liked = likedEntries();
  if (!liked.length) { setStatus('No liked videos available.'); return; }
  const inUse = new Set(tiles.map(x => x.label));
  let pool = liked.filter(e => e.key !== t.label && !inUse.has(e.key));
  if (!pool.length) pool = liked.filter(e => e.key !== t.label);
  if (!pool.length) pool = liked;
  const e = pool[Math.floor(Math.random() * pool.length)];
  setTileSource(t, await urlFor(e), e.key);
  if (tile.isFloat) syncFloat();
}
// Dealing order per the "Deal" setting: all videos / liked first / liked only. Returns a function yielding entries.
function makeDealer(exclude = new Set()) {
  const mode = $('dealMode').value, liked = likedEntries().filter(e => !pinnedKeys.has(e.key));
  const fresh = arr => shuffled(arr.filter(e => !exclude.has(e.key)));
  let first = (mode !== 'all' && liked.length ? fresh(liked) : []).concat(fresh(pinnedEntries()));   // popped from the end: pinned first
  const restPool = mode === 'likedOnly' && liked.length ? liked : dealable();
  if (!restPool.length) return () => library[Math.floor(Math.random() * library.length)];   // everything dismissed: fall back to the whole library
  let rest = [];
  return () => {
    if (first.length) return first.pop();
    if (!rest.length) rest = fresh(restPool);
    if (!rest.length) rest = shuffled(restPool);
    return rest.pop();
  };
}
$('clearLikes').addEventListener('click', async () => { likes = []; rebuildLikedKeys(); await persistLikes(); });
// ---- Pins: videos that stay up. A pinned screen cannot be removed, is skipped by Shuffle and ignores the swap tap;
// dropping another video onto it replaces and unpins. Pinned videos are dealt first after a full rebuild.
let pins = [];             // [{ handle, rootName, rel, name }]
let pinnedKeys = new Set();
function rebuildPinnedKeys() {
  const ids = new Set(pins.map(likeId));
  pinnedKeys = new Set(library.filter(e => ids.has(likeId(e))).map(e => e.key));
  $('pinInfo').textContent = pins.length ? `${pins.length} pinned` : '';
}
const isPinnedKey = key => pinnedKeys.has(key);
const tilePinned = t => { const o = t && t.isFloat ? t.origin : t; return !!o && isPinnedKey(o.label); };
const pinnedEntries = () => library.filter(e => pinnedKeys.has(e.key) && !dismissedKeys.has(e.key));
async function persistPins() { await kvSet('pins', pins.map(l => ({ handle: l.handle, rootName: l.rootName, rel: l.rel, name: l.name }))); }
async function togglePin(tile) {
  const t = tile.isFloat ? tile.origin : tile; if (!t) return;
  const e = library.find(x => x.key === t.label);
  if (!e) { setStatus('Only library videos can be pinned.'); return; }
  const id = likeId(e), i = pins.findIndex(l => likeId(l) === id);
  if (i >= 0) pins.splice(i, 1); else pins.push({ handle: e.handle, rootName: e.rootName, rel: e.rel, name: e.name });
  rebuildPinnedKeys();
  await persistPins();
}
async function unpinKey(key) {
  const e = library.find(x => x.key === key); if (!e) return;
  const id = likeId(e); pins = pins.filter(l => likeId(l) !== id);
  rebuildPinnedKeys();
  await persistPins();
}
// A pinned video that just left its last screen (replaced by an explicit drop) is unpinned
function unpinIfGone(label) { if (label && isPinnedKey(label) && !tiles.some(t => t.label === label)) unpinKey(label); }
$('clearPins').addEventListener('click', async () => { pins = []; rebuildPinnedKeys(); await persistPins(); });
// ---- Dismissed: videos that are never dealt again (shuffle, split, deploy ♥, startup, swap tap, ↶ ↷).
// They stay in the library; the browser panel lists them for undismissing.
let dismissed = [];        // [{ handle, rootName, rel, name }]
let dismissedKeys = new Set();
function rebuildDismissedKeys() {
  const ids = new Set(dismissed.map(likeId));
  dismissedKeys = new Set(library.filter(e => ids.has(likeId(e))).map(e => e.key));
  $('dismissInfo').textContent = dismissed.length ? `${dismissed.length}` : 'none';
  renderDismissed();
}
const isDismissedKey = key => dismissedKeys.has(key);
const dealable = () => library.filter(e => !dismissedKeys.has(e.key));
async function persistDismissed() { await kvSet('dismissed', dismissed.map(l => ({ handle: l.handle, rootName: l.rootName, rel: l.rel, name: l.name }))); }
function renderDismissed() {
  const box = $('dismissedList'); box.innerHTML = '';
  dismissed.forEach(d => {
    const row = document.createElement('div'); row.className = 'root';
    row.textContent = `${d.rootName} / ${d.rel} `;
    const x = document.createElement('button'); x.textContent = '×'; x.title = 'undismiss';
    x.addEventListener('click', async () => { dismissed = dismissed.filter(e => e !== d); rebuildDismissedKeys(); await persistDismissed(); });
    row.appendChild(x); box.appendChild(row);
  });
}
// Dismiss the video on this screen: list it, unpin it, and swap every screen showing it to something else.
async function dismissTile(tile) {
  const t = tile.isFloat ? tile.origin : tile; if (!t) return;
  const e = library.find(x => x.key === t.label);
  if (!e) { setStatus('Only library videos can be dismissed.'); return; }
  const id = likeId(e);
  if (!dismissed.some(l => likeId(l) === id)) dismissed.push({ handle: e.handle, rootName: e.rootName, rel: e.rel, name: e.name });
  rebuildDismissedKeys();
  await persistDismissed();
  if (isPinnedKey(e.key)) await unpinKey(e.key);
  for (const x of tiles.slice()) if (x.label === e.key) await swapTile(x);
  if (tile.isFloat) syncFloat();
}
$('showDismissed').addEventListener('click', () => { const l = $('dismissedList'); l.style.display = l.style.display === 'none' ? '' : 'none'; });
$('clearDismissed').addEventListener('click', async () => { dismissed = []; rebuildDismissedKeys(); await persistDismissed(); });
// ---- Per-screen history: every video a screen has shown (library keys), with ↶ / ↷ moving through it.
const HIST_MAX = 16;
function pushHist(tile, key) {
  if (!key || !library.some(e => e.key === key)) return;
  const h = tile.hist || (tile.hist = { list: [], i: -1 });
  if (h.list[h.i] === key) return;
  h.list = h.list.slice(0, h.i + 1); h.list.push(key);
  if (h.list.length > HIST_MAX) h.list.shift();
  h.i = h.list.length - 1;
}
const histAvail = key => !isDismissedKey(key) && library.some(e => e.key === key);
function histTarget(tile, dir) {   // index of the next usable entry in that direction, or -1
  const h = tile.hist; if (!h) return -1;
  for (let i = h.i + dir; i >= 0 && i < h.list.length; i += dir) if (histAvail(h.list[i])) return i;
  return -1;
}
async function histStep(tile, dir) {
  const t = tile.isFloat ? tile.origin : tile; if (!t) return;
  const i = histTarget(t, dir); if (i < 0) return;
  const e = library.find(x => x.key === t.hist.list[i]); if (!e) return;
  t.hist.i = i;
  setTileSource(t, await urlFor(e), e.key, popIn, true);
  if (tile.isFloat) syncFloat();
}
$('exportLikes').addEventListener('click', () => {
  const row = l => ({ folder: l.rootName, path: l.rel, name: l.name });
  const blob = new Blob([JSON.stringify({ likes: likes.map(row), pins: pins.map(row), dismissed: dismissed.map(row) }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'video-room-likes.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('dealMode').addEventListener('change', () => kvSet('dealMode', $('dealMode').value));
function renderRoots() {
  const box = $('roots'); box.innerHTML = '';
  const pending = roots.filter(r => !r.granted);
  for (const r of roots) {
    const row = document.createElement('div'); row.className = 'root';
    const icon = r.kind === 'dir' ? '📁' : '🎞';
    const info = r.granted ? `${r.entries.length} video${r.entries.length === 1 ? '' : 's'}` : 'click to reopen';
    row.innerHTML = `<span class="rname" title="${r.name}">${icon} ${r.name}</span><span class="rinfo">${info}</span>` +
      (r.kind === 'dir' ? `<label><input type="checkbox" class="rsub" ${r.sub ? 'checked' : ''}/> subfolders</label>` : '') +
      `<button class="rdel" title="Remove">×</button>`;
    if (!r.granted) { row.querySelector('.rinfo').style.cursor = 'pointer'; row.querySelector('.rinfo').onclick = regrant; }
    const sub = row.querySelector('.rsub');
    if (sub) sub.onchange = async () => { r.sub = sub.checked; await persistRoots(); await scanRoot(r); rebuildLibrary(); await refill(); };
    row.querySelector('.rdel').onclick = () => removeRoot(r);
    box.appendChild(row);
  }
  const n = library.length;
  $('libInfo').textContent = roots.length ? `${n} video${n === 1 ? '' : 's'} from ${roots.length} source${roots.length === 1 ? '' : 's'}` +
    (pending.length ? ` (${pending.length} to reopen)` : '') : '';
}
async function persistRoots() {
  await kvSet('roots', roots.map(r => ({ kind: r.kind, handle: r.handle, handles: r.handles, name: r.name, sub: r.sub })));
}
async function urlFor(entry) {
  if (!entry.url) {
    const f = entry.handle.getFile ? await entry.handle.getFile() : entry.handle;
    entry.url = URL.createObjectURL(f);
  }
  return entry.url;
}
async function addRoot(r) {
  r.id = ++rootSeq; r.granted = true; r.entries = [];
  await scanRoot(r);
  if (!r.entries.length) { setStatus(`No video files found in "${r.name}". ${scanSummary(r)}`); return; }
  if (r.scan?.failed.length) setStatus(`Added "${r.name}": ${r.entries.length} videos. ${scanSummary(r)}`);
  roots.push(r);
  await persistRoots();
  rebuildLibrary();
  await dealRandom();
}
async function removeRoot(r) {
  roots = roots.filter(x => x !== r);
  await persistRoots();
  rebuildLibrary();
  const prefix = `${r.id}:`;
  if (!library.length) { disposeVideos(); setStatus('Library is empty.'); }
  else for (const t of tiles) if (t.label.startsWith(prefix)) await swapTile(t);
  for (const e of r.entries) if (e.url) URL.revokeObjectURL(e.url);
}
// After a rescan: screens whose video vanished get a new one; empty screens get filled.
async function refill() {
  const keys = new Set(library.map(e => e.key));
  if (!library.length) { disposeVideos(); return; }
  for (const t of tiles) if (!t.label || !keys.has(t.label)) await swapTile(t);
  setStatus(`${tiles.length} screens, ${videoEls.length} decoder(s) from ${library.length} library videos.`);
}
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function clearTile(t) {
  cancelTransition(t);
  const v = t.video, m = t.mesh.material;
  t.mesh.material = placeholder; t.video = null; t.label = '';
  retire(v, m);
}
async function dealRandom() {
  if (!library.length) return;
  const keep = new Set(tiles.filter(t => isPinnedKey(t.label)));
  if (!keep.size) disposeVideos(); else { unfocus(true); for (const t of tiles) if (!keep.has(t)) clearTile(t); }
  const next = makeDealer(new Set([...keep].map(t => t.label)));
  for (const t of tiles) { if (keep.has(t)) continue; const e = next(); setTileSource(t, await urlFor(e), e.key); }
  setStatus(`${tiles.length} screens, ${videoEls.length} decoder(s) from ${library.length} library videos.`);
}
// Swap one tile to a random library video not currently on any screen (if possible)
async function swapTile(tile) {
  if (!library.length) { setStatus('Swap needs a folder library.'); return; }
  const inUse = new Set(tiles.map(t => t.label)), src = dealable().length ? dealable() : library;
  let pool = src.filter(e => e.key !== tile.label && !inUse.has(e.key));
  if (!pool.length) pool = src.filter(e => e.key !== tile.label);
  if (!pool.length) return;
  const e = pool[Math.floor(Math.random() * pool.length)];
  setTileSource(tile, await urlFor(e), e.key);
}

$('pickFolder').addEventListener('click', async () => {
  if (!window.showDirectoryPicker) { setStatus('Folder picking needs Chrome or Edge.'); return; }
  try {
    const dir = await showDirectoryPicker({ mode: 'read' });
    await addRoot({ kind: 'dir', handle: dir, name: dir.name, sub: true });
  } catch (e) { if (e.name !== 'AbortError') setStatus('Folder error: ' + e.message); }
});
$('pickFiles').addEventListener('click', async () => {
  if (!window.showOpenFilePicker) { $('files').click(); return; }
  try {
    const handles = await showOpenFilePicker({ multiple: true, types: [{ description: 'Videos', accept: { 'video/*': ['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.ogv'] } }] });
    if (!handles.length) return;
    await addRoot({ kind: 'files', handles, name: handles.length === 1 ? handles[0].name : `${handles.length} files`, sub: false });
  } catch (e) { if (e.name !== 'AbortError') setStatus('File error: ' + e.message); }
});
$('files').addEventListener('change', async e => {   // fallback when showOpenFilePicker is missing
  const fs = [...e.target.files]; e.target.value = ''; if (!fs.length) return;
  await addRoot({ kind: 'files', handles: fs, name: fs.length === 1 ? fs[0].name : `${fs.length} files`, sub: false });
});
$('shuffle').addEventListener('click', dealRandom);

// Re-grant read permission for every root that lost it (needs a click; Chrome may need one click per root).
async function regrant() {
  for (const r of roots.filter(x => !x.granted)) {
    const hs = r.kind === 'dir' ? [r.handle] : r.handles;
    let ok = true;
    for (const h of hs) if (h.requestPermission && await h.requestPermission({ mode: 'read' }) !== 'granted') { ok = false; break; }
    if (!ok) { renderRoots(); return; }
    r.granted = true; await scanRoot(r);
  }
  rebuildLibrary();
  if (library.length) await (tiles.some(t => t.label) ? refill() : dealRandom());
}
async function hasPermission(r) {
  const hs = r.kind === 'dir' ? [r.handle] : r.handles;
  for (const h of hs) if (h.queryPermission && await h.queryPermission({ mode: 'read' }) !== 'granted') return false;
  return true;
}
(async () => {
  likes = (await kvGet('likes')) || [];
  pins = (await kvGet('pins')) || [];
  dismissed = (await kvGet('dismissed')) || [];
  const dm = await kvGet('dealMode'); if (dm) $('dealMode').value = dm;
  const tr = await kvGet('transitions'); if (tr) $('transitions').value = tr;
  rebuildLikedKeys();
  let saved = await kvGet('roots');
  const legacy = await kvGet('folder');          // single-folder format from before multi-root support
  if (!saved && legacy) { saved = [{ kind: 'dir', handle: legacy, name: legacy.name, sub: true }]; await kvSet('roots', saved); await kvDel('folder'); }
  if (!saved || !saved.length) return;
  for (const s of saved) {
    const r = { ...s, id: ++rootSeq, granted: false, entries: [] };
    if (await hasPermission(r)) { r.granted = true; await scanRoot(r); }
    roots.push(r);
  }
  rebuildLibrary();
  if (library.length) await dealRandom();
})();

// ---- Other UI ----
async function clearLibrary() {
  for (const e of library) if (e.url) URL.revokeObjectURL(e.url);
  roots = []; library = []; await persistRoots(); renderRoots();
}
$('apply').addEventListener('click', buildLayout);
function syncShapeFields() {
  const v = $('shape').value, prism = v === 'prism', poly = !!POLY_SHAPES[v], box = v === 'box', trap = v === 'trap';
  $('prismFields').style.display = prism || trap ? '' : 'none';
  $('trapHint').style.display = trap ? '' : 'none';
  $('prismN').max = trap ? 16 : 48;
  $('dField').style.display = box ? '' : 'none';
  $('hField').style.display = poly ? 'none' : '';
  $('wLabel').textContent = box ? 'W' : 'Across';
  $('faceRow').style.display = poly ? '' : 'none';
  $('cropRow').style.display = poly ? '' : 'none';
  syncNestFields();
  $('wallRow').style.display = poly ? 'none' : '';
  $('flatRow').style.display = poly ? 'none' : '';
}
$('shape').addEventListener('change', syncShapeFields);
$('maxCrop').addEventListener('change', refitAll);
$('fillMode').addEventListener('change', () => { syncNestFields(); refitAll(); });
for (const id of ['nestDepth', 'nestInc', 'nestFallback', 'nestFlip']) $(id).addEventListener('change', refitAll);
function syncNestFields() { $('nestRow').style.display = $('fillMode').value === 'nested' && $('cropRow').style.display !== 'none' ? '' : 'none'; }
syncShapeFields();
$('useSample').addEventListener('click', () => { sources = [{ src: SAMPLE, label: 'Sample' }]; applySources(); });
$('clear').addEventListener('click', async () => { await clearLibrary(); sources = []; disposeVideos(); setStatus('Cleared.'); });
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
  cancelTransition(a); cancelTransition(b);
  const va = a.video, ma = a.mesh.material, la = a.label, vb = b.video, mb = b.mesh.material, lb = b.label;
  a.video = vb; a.label = lb; b.video = va; b.label = la;
  pushHist(a, lb); pushHist(b, la);
  const put = (t, v, m) => { if (v) enterWith(t, v, m, () => { t.mesh.material = m; refitTile(t); }); else { t.mesh.material = m; refitTile(t); } };
  put(a, vb, mb); put(b, va, ma);
}
// Put the same video (same decoder, in sync) on another screen
function copyTo(src, dst) {
  if (src.isFloat) src = src.origin; if (dst.isFloat) dst = dst.origin;
  if (!src || !dst || src === dst || !src.video) return;
  unfocus(true);
  cancelTransition(src); cancelTransition(dst);
  const old = dst.video, oldMat = dst.mesh.material, mat = src.mesh.material, oldLabel = dst.label;
  dst.video = src.video; dst.label = src.label;
  pushHist(dst, src.label);
  unpinIfGone(oldLabel);
  enterWith(dst, src.video, mat, () => { dst.mesh.material = mat; refitTile(dst); retire(old, oldMat); });
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
  const level = roomLevel();
  roomScale = s0; toRoomLocal(_head, _lv); roomScale = Math.max(1.5 / base, Math.min(40 / base, s0 * f));
  roomGroup.scale.setScalar(roomScale);
  _lv2.copy(_lv).multiplyScalar(roomScale).applyQuaternion(roomGroup.quaternion);
  roomGroup.position.x = _head.x - _lv2.x;
  roomGroup.position.z = _head.z - _lv2.z;
  if (!level) roomGroup.position.y = _head.y - _lv2.y;   // tilted: scale about the head in 3D
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
const floatHL = makeRing([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], 0.012);
floatHL.position.z = -0.003; floatHL.visible = false;
floatHL.material = ringMat.clone(); floatHL.material.depthTest = false; floatHL.renderOrder = 21;
const floatIcon = makeIcon(); floatIcon.renderOrder = 22;
floatMesh.renderOrder = 20;   // the focus screen draws over everything (its material gets depthTest off in syncFloat)
floatGroup.add(floatMesh, floatHL, floatIcon);
floatGroup.visible = false;
const floatTile = { mesh: floatMesh, w: 1, h: 1, video: null, label: '', highlight: floatHL, icon: floatIcon, isFloat: true, origin: null, outline: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] };
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
  floatMesh.material.depthTest = false; floatMesh.material.needsUpdate = true;
  focused.mesh.material = dimMat;     // wall slot goes dark while its video is out
}
function applyDim(on) {
  const dim = on && $('dimOthers').checked;
  for (const t of tiles) if (t !== focused && t.mesh.material !== placeholder && t.mesh.material !== dimMat)
    t.mesh.material.color.setScalar(dim ? 0.25 : 1);
}
const _toTile = new THREE.Vector3();
function focusTarget() {
  // Along the line from the eye to the screen being focused, so the panel opens where you were looking
  // (works for floor, ceiling and sloped faces too). Uses the live XR head pose when presenting.
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(_eye);
  focused.mesh.getWorldPosition(_toTile);
  _fwd.subVectors(_toTile, _eye);
  if (_fwd.lengthSq() < 1e-4) { cam.getWorldDirection(_fwd); }
  _fwd.normalize();
  // Limit the pitch so the panel never sits straight above or below you.
  const maxPitch = THREE.MathUtils.degToRad(65);
  let pitch = Math.asin(THREE.MathUtils.clamp(_fwd.y, -1, 1));
  pitch = THREE.MathUtils.clamp(pitch, -maxPitch, maxPitch);
  const hz = Math.hypot(_fwd.x, _fwd.z);
  if (hz < 1e-4) { cam.getWorldDirection(_toTile); _toTile.y = 0; if (_toTile.lengthSq() < 1e-4) _toTile.set(0, 0, -1); _toTile.normalize(); }
  else _toTile.set(_fwd.x / hz, 0, _fwd.z / hz);
  _fwd.set(_toTile.x * Math.cos(pitch), Math.sin(pitch), _toTile.z * Math.cos(pitch));
  // Distance: a comfortable fixed distance, but never past the nearest wall, floor or ceiling in that direction.
  const dist = focusDistance(_eye, _fwd);
  const v = focused.video;
  const aspect = v && v.videoWidth ? v.videoWidth / v.videoHeight : focused.w / focused.h;
  const [fw, fh] = focusSize(dist, aspect);
  const p = _eye.clone().addScaledVector(_fwd, dist);
  // Keep the (tilted) panel clear of floor and ceiling.
  const half = fh / 2 * Math.cos(pitch) + 0.05, top = H * roomScale, fy = roomGroup.position.y;
  if (roomLevel()) p.y = top > 2 * half ? THREE.MathUtils.clamp(p.y, fy + half, fy + top - half) : _eye.y;
  // PlaneGeometry faces +z; Matrix4.lookAt(eye, target) points +z from target toward eye,
  // so pass the viewer as "eye" and the panel as "target" to make the panel face the viewer.
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(_eye, p, new THREE.Vector3(0, 1, 0)));
  return { p, q, s: new THREE.Vector3(fw, fh, 1) };
}
// How far in front of the viewer the focus screen sits: 2.5 m, or 85% of the way to the wall if closer.
function focusDistance(eye, fwd) {
  toRoomLocal(eye, _lv); toRoomLocalDir(fwd, _lv2);
  let toWall = Infinity;
  for (const p of roomPlanes()) {
    const along = _lv2.x * p.nx + _lv2.y * p.ny + _lv2.z * p.nz;
    if (along <= 1e-4) continue;
    const d = p.dist - (_lv.x * p.nx + (_lv.y - polyCentreY) * p.ny + _lv.z * p.nz);
    toWall = Math.min(toWall, d / along);
  }
  return Math.max(0.6, Math.min(2.5, toWall * roomScale * 0.85));
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
  focused = tile; floatTile.origin = tile; floatTile.custom = false;
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
    if (tile.mesh.material !== placeholder) { tile.mesh.material.depthTest = true; tile.mesh.material.needsUpdate = true; }
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
  const aspect = v.videoWidth / v.videoHeight;
  if (floatTile.custom) { const fh = floatGroup.scale.x / aspect; if (Math.abs(floatGroup.scale.y - fh) > 0.01) floatGroup.scale.y = fh; return; }
  const dist = _eye.distanceTo(floatGroup.position);
  const [fw, fh] = focusSize(dist, aspect);
  if (Math.abs(floatGroup.scale.y - fh) > 0.01 || Math.abs(floatGroup.scale.x - fw) > 0.01) floatGroup.scale.set(fw, fh, 1);
}, 500);

// ---- Grid/split buttons: a small panel of fixed physical size, tucked into the hovered tile's bottom-right corner.
const PANEL_DEG = 5, PANEL_MARGIN = 0.02;   // panel height as an angle at the eye (buttons ≈ 3°), margin in metres
const panelCanvas = document.createElement('canvas');
panelCanvas.width = 1700; panelCanvas.height = 160;
const BTN_W = 96, BTN_GAP = 10;
// Button groups: grid (cols/rows, or split level on a polyhedron face), then zoom −/+ and reset for this screen.
// Layout: − removes this piece (its siblings re-flow), + adds a sibling, ⊞ splits this piece into two.
const LAYOUT_BUTTONS = [
  { label: '−', title: 'pieces', act: 'remove' }, { label: '+', title: 'pieces', act: 'add' }, { label: '⊞', title: 'split', act: 'split' },
];
const ZOOM_BUTTONS = [{ label: '−', title: 'zoom', dz: -1 }, { label: '+', title: 'zoom', dz: 1 }, { label: '↺', title: 'reset', reset: true }];
const LIKE_BUTTON = { label: '♥', title: 'like', like: true };
const PIN_BUTTON = { label: '📌', title: 'pin', pin: true };
const DISMISS_BUTTON = { label: '✕', title: 'dismiss (hold)', dismiss: true, hold: true, solo: true };
const HIST_BUTTONS = [{ label: '↶', title: 'history', hist: -1 }, { label: '↷', title: 'history', hist: 1 }];
const HOLD_MS = 700;         // hold the trigger (or mouse button) this long on a hold button
let panelHold = null;        // { idx, frac } while a hold button is being held
let panelBtns = [];          // current layout: buttons with x0/x1 (canvas px)
let panelHoverBtn = -1;
function panelLayout() {
  const out = [];
  let x = 124;
  const put = b => { out.push({ ...b, x0: x, x1: x + BTN_W }); x += BTN_W + BTN_GAP; };
  put(DISMISS_BUTTON); x += 26;                // destructive and history buttons far from ♥ / 📌
  HIST_BUTTONS.forEach(put); x += 26;
  LAYOUT_BUTTONS.forEach((b, i) => { if (i === 2) x += 26; put(b); });
  x += 150;                                   // room for the zoom value
  ZOOM_BUTTONS.forEach((b, i) => { if (i === 2) x += 26; put(b); });
  x += 26; put(LIKE_BUTTON); put(PIN_BUTTON);
  return out;
}
function setPanelHold(idx, frac) {
  panelHold = idx == null ? null : { idx, frac };
  if (focusTile) drawPanel(focusTile);
}
function panelButtonAt(uv) {
  if (!uv) return -1;
  const x = uv.x * panelCanvas.width, y = (1 - uv.y) * panelCanvas.height;
  if (y < 30 || y > 150) return -1;
  return panelBtns.findIndex(b => x >= b.x0 - 5 && x <= b.x1 + 5);
}
const ZOOM_STEP = 1.25;
// Focus screen size limits (metres wide) for the panel buttons and grip-drag
const FLOAT_W_MIN = 0.1, FLOAT_W_MAX = 60;
function resetFloatPose() { const to = focusTarget(); floatGroup.position.copy(to.p); floatGroup.quaternion.copy(to.q); floatGroup.scale.copy(to.s); floatTile.custom = false; }
function scaleFloat(w) {
  w = Math.max(FLOAT_W_MIN, Math.min(FLOAT_W_MAX, w));
  floatGroup.scale.set(w, w * floatGroup.scale.y / floatGroup.scale.x, 1);
  floatTile.custom = true;
}
function pressPanelButton(tile, idx) {
  const b = panelBtns[idx]; if (!b) return;
  const t = tile.isFloat ? tile.origin : tile;
  if (!t) return;
  if (tile.isFloat && (b.reset || b.dz)) {   // on the focus screen, zoom buttons scale the floating screen itself
    if (b.reset) resetFloatPose(); else scaleFloat(floatGroup.scale.x * Math.pow(ZOOM_STEP, b.dz));
    drawPanel(tile); return;
  }
  if (b.reset) { resetView(t); drawPanel(tile); return; }
  if (b.like) { toggleLike(t).then(() => drawPanel(tile)); return; }
  if (b.pin) { togglePin(t).then(() => drawPanel(tile)); return; }
  if (b.dismiss) { dismissTile(tile); return; }
  if (b.hist) { histStep(tile, b.hist); return; }
  if (b.dz) {
    if (!t.fit) return;
    const z0 = t.view && t.view.zoom != null ? t.view.zoom : t.fit.zoomDefault;
    const zoom = Math.max(1, Math.min(2 * t.fit.coverRatio, z0 * Math.pow(ZOOM_STEP, b.dz)));
    t.view = { zoom, dx: t.view ? t.view.dx : 0, dy: t.view ? t.view.dy : 0 };
    refitTile(t); drawPanel(tile); return;
  }
  if (b.act) layoutAction(t, b.act);
}
const panelCtx = panelCanvas.getContext('2d');
const panelTex = new THREE.CanvasTexture(panelCanvas);
panelTex.colorSpace = THREE.SRGBColorSpace;
const panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: panelTex, transparent: true, depthTest: false }));
panelMesh.renderOrder = 30; panelMesh.visible = false;
function drawPanel(tile) {
  const c = panelCtx, Wc = panelCanvas.width, Hc = panelCanvas.height;
  const src = tile.isFloat ? tile.origin : tile;
  const node = src && src.node, siblings = node ? (node.parent ? node.parent.children.length : 1) : 0;
  let depth = 0; for (let n = node; n && n.parent; n = n.parent) depth++;
  panelBtns = panelLayout();
  const wide = panelBtns[panelBtns.length - 1].x1 + 20;
  c.clearRect(0, 0, Wc, Hc);
  c.fillStyle = 'rgba(0,0,0,0.7)';
  c.beginPath(); c.roundRect(0, 0, wide, Hc, 24); c.fill();
  c.textBaseline = 'middle'; c.textAlign = 'center';
  c.fillStyle = '#ddd'; c.font = 'bold 40px system-ui, sans-serif';
  c.fillText(node ? `${siblings}${depth > 1 ? '·' + depth : ''}` : '', 62, 90);   // siblings in this piece's group (· nesting depth)
  // zoom value for this screen (relative to "whole video visible"); custom values are marked
  const fit = src && src.fit, zoom = fit ? (src.view && src.view.zoom != null ? src.view.zoom : fit.zoomDefault) : 0;
  const zb = panelBtns.find(b => b.dz);
  if (tile.isFloat) c.fillText(`${floatGroup.scale.x.toFixed(floatGroup.scale.x < 10 ? 1 : 0)} m${floatTile.custom ? '*' : ''}`, zb.x0 - 80, 90);
  else c.fillText(fit ? `${zoom.toFixed(2)}×${src.view ? '*' : ''}` : '', zb.x0 - 80, 90);
  let labelled = new Set();
  const liked = src && isLikedKey(src.label), pinned = src && isPinnedKey(src.label);
  panelBtns.forEach((b, i) => {
    c.fillStyle = i === panelHoverBtn ? '#4aa8ff' : pinned && b.pin ? '#5a4a10' : '#2e2e2e';
    c.beginPath(); c.roundRect(b.x0, 44, BTN_W, 88, 14); c.fill();
    if (panelHold && panelHold.idx === i) {   // hold progress fills the button from the left
      c.save(); c.beginPath(); c.roundRect(b.x0, 44, BTN_W, 88, 14); c.clip();
      c.fillStyle = '#d04040'; c.fillRect(b.x0, 44, BTN_W * Math.min(1, panelHold.frac), 88); c.restore();
    }
    const off = (b.act === 'remove' && (!(node && node.parent) || pinned))   // the only piece of a surface, or a pinned one, cannot be removed
             || (b.hist && (!src || histTarget(src, b.hist) < 0));
    c.fillStyle = b.like ? (liked ? '#ff4a6a' : '#777') : off ? '#666' : '#fff'; c.font = 'bold 56px system-ui, sans-serif';
    c.globalAlpha = b.pin && !pinned ? 0.35 : 1;
    c.fillText(b.label, b.x0 + BTN_W / 2, 88);
    c.globalAlpha = 1;
    const title = b.title;
    if (!labelled.has(title)) {
      labelled.add(title);
      c.fillStyle = '#aaa'; c.font = '26px system-ui, sans-serif';
      c.fillText(title, b.reset || b.solo ? b.x0 + BTN_W / 2 : b.x0 + BTN_W + BTN_GAP / 2, 22);
    }
  });
  panelTex.needsUpdate = true;
  return wide / Wc;   // fraction of the canvas in use, so the mesh can be trimmed to it
}
// Horizontal chord [xl, xr] of a convex polygon at height y, or null.
function chordAt(pts, y) {
  let xl = Infinity, xr = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if ((y < a[1]) === (y < b[1])) continue;
    const x = a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
    xl = Math.min(xl, x); xr = Math.max(xr, x);
  }
  return xl <= xr ? [xl, xr] : null;
}
// Lowest band of height bh whose interior width is at least minW; returns { y (bottom), xl, xr } or null.
function fitBand(pts, bh, minW, yMin, fromTop = false) {
  const ys = pts.map(p => p[1]), y0 = Math.max(Math.min(...ys), yMin), y1 = Math.max(...ys) - bh;
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const y = y0 + (y1 - y0) * (fromTop ? steps - i : i) / steps;
    const lo = chordAt(pts, y + 1e-6), hi = chordAt(pts, y + bh - 1e-6);
    if (!lo || !hi) continue;
    const xl = Math.max(lo[0], hi[0]), xr = Math.min(lo[1], hi[1]);
    if (xr - xl >= minW) return { y, xl, xr };
  }
  return null;
}
function placePanel(tile) {
  const used = drawPanel(tile);
  const aspect = (panelCanvas.width * used) / panelCanvas.height;
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(_eye); tile.mesh.getWorldPosition(_iw);
  const panelH = 2 * _eye.distanceTo(_iw) * Math.tan(THREE.MathUtils.degToRad(PANEL_DEG / 2));   // metres, constant apparent size
  if (tile.isFloat) {   // unit space inside floatGroup (scaled to the screen size)
    const fw = floatGroup.scale.x, fh = floatGroup.scale.y;
    const pw = panelH * aspect / fw, ph = panelH / fh, m = PANEL_MARGIN / fw;
    panelMesh.scale.set(pw, ph, 1);
    panelMesh.position.set(0.5 - m - pw / 2, -0.5 + PANEL_MARGIN / fh + ph / 2, 0.005);
    return;
  }
  const k = 1 / roomScale;   // local units per metre
  const m = PANEL_MARGIN * k;
  let scale = 1, band = null, pw = 0, ph = 0;
  for (; scale >= 0.3; scale *= 0.8) {
    pw = panelH * aspect * k * scale; ph = panelH * k * scale;
    band = fitBand(tile.outline, ph + 2 * m, pw + 2 * m, -Infinity);
    if (band) break;
  }
  panelMesh.scale.set(pw, ph, 1);
  if (band) panelMesh.position.set(tile.mesh.position.x + band.xr - m - pw / 2, tile.mesh.position.y + band.y + m + ph / 2, 0.005);
  else panelMesh.position.set(tile.mesh.position.x, tile.mesh.position.y, 0.005);
}
// ---- Station board: a small table that follows you at waist height, below the straight-ahead view.
// Faint until you look at it or point at it. Its slots are drag sources: drag "Deploy favourite" onto a screen.
const BOARD_W = 0.5, BOARD_H = 0.25, BOARD_AHEAD = 0.55, BOARD_DROP = 0.9, BOARD_TILT = THREE.MathUtils.degToRad(-55);
const board = new THREE.Group();
scene.add(board);
const boardMat = new THREE.MeshBasicMaterial({ color: 0x101418, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false });
const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H), boardMat);
boardMesh.renderOrder = 25;
board.add(boardMesh);
function slotTexture(draw) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = '#2a2f36'; c.beginPath(); c.roundRect(8, 8, 240, 240, 36); c.fill();
  draw(c);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
const deploySlotMat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, map: slotTexture(c => {
  c.fillStyle = '#ff4a6a'; c.beginPath();                                        // heart
  c.moveTo(128, 190); c.bezierCurveTo(40, 130, 60, 50, 128, 95); c.bezierCurveTo(196, 50, 216, 130, 128, 190); c.fill();
  c.fillStyle = '#fff'; c.font = 'bold 30px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('deploy →', 128, 225);
}) });
const deploySlot = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), deploySlotMat);
deploySlot.position.set(-BOARD_W / 2 + 0.09, 0, 0.002); deploySlot.renderOrder = 26; deploySlot.userData.slot = 'liked';
board.add(deploySlot);
const shuffleSlotMat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, map: slotTexture(c => {
  c.strokeStyle = '#4aa8ff'; c.lineWidth = 16; c.lineCap = 'round'; c.lineJoin = 'round';   // two crossing arrows
  c.beginPath(); c.moveTo(50, 70); c.lineTo(100, 70); c.lineTo(156, 140); c.lineTo(200, 140); c.stroke();
  c.beginPath(); c.moveTo(50, 140); c.lineTo(100, 140); c.lineTo(156, 70); c.lineTo(200, 70); c.stroke();
  c.fillStyle = '#4aa8ff';
  c.beginPath(); c.moveTo(190, 48); c.lineTo(222, 70); c.lineTo(190, 92); c.fill();
  c.beginPath(); c.moveTo(190, 118); c.lineTo(222, 140); c.lineTo(190, 162); c.fill();
  c.fillStyle = '#fff'; c.font = 'bold 30px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('shuffle', 128, 225);
}) });
const shuffleSlot = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), shuffleSlotMat);
shuffleSlot.position.set(-BOARD_W / 2 + 0.24, 0, 0.002); shuffleSlot.renderOrder = 26; shuffleSlot.userData.slot = 'shuffle';
board.add(shuffleSlot);
const boardSlots = [deploySlot, shuffleSlot];
const BOARD_SLOT = { isBoard: true, label: '' };   // drag source sentinel for the deploy slot
const _bf = new THREE.Vector3(), _bq = new THREE.Quaternion(), _bm = new THREE.Matrix4();
let boardYaw = null, boardHot = false;
function updateBoard(dt) {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(_eye);
  cam.getWorldDirection(_bf);
  const yaw = Math.atan2(_bf.x, _bf.z);
  if (boardYaw === null) boardYaw = yaw;
  let d = yaw - boardYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
  boardYaw += d * Math.min(1, dt * 4);                                        // lazy follow
  const fx = Math.sin(boardYaw), fz = Math.cos(boardYaw);
  board.position.set(_eye.x + fx * BOARD_AHEAD, _eye.y - BOARD_DROP, _eye.z + fz * BOARD_AHEAD);
  _bm.lookAt(_eye, board.position, new THREE.Vector3(0, 1, 0));                // +z toward the viewer
  board.quaternion.setFromRotationMatrix(_bm);
  _bq.setFromAxisAngle(new THREE.Vector3(1, 0, 0), BOARD_TILT);
  board.quaternion.multiply(_bq);
  // looking at it (within ~25° of the gaze) or pointing at it: opaque; otherwise faint
  _bq.identity();
  const toBoard = board.position.clone().sub(_eye).normalize();
  const gazing = toBoard.dot(_bf) > Math.cos(THREE.MathUtils.degToRad(25));
  const target = gazing || boardHot ? 1 : 0.3;
  boardMat.opacity += (target - boardMat.opacity) * Math.min(1, dt * 8);
  deploySlotMat.opacity = shuffleSlotMat.opacity = boardMat.opacity;
}

// Per-frame HUD: contour progress on the hovered screen, floating sound icons on hovered or audible screens.
const _iw = new THREE.Vector3();
function updateHud() {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(_eye);
  if (focusTile) {
    const v = focusTile.video, dur = v && isFinite(v.duration) ? v.duration : 0;
    setRingProgress(focusTile.highlight, dur ? v.currentTime / dur : 0);
  }
  const all = focused ? [...tiles, floatTile] : tiles;
  for (const t of all) {
    const v = t.video;
    const show = t === focusTile || (v && !v.muted && !(focused && t === focused));
    if (!show) { t.icon.visible = false; continue; }
    t.icon.visible = true;
    t.icon.material = iconMaterial(v && !v.muted, v && v.paused, t.isFloat, isLikedKey(t.label), isPinnedKey(t.label));
    t.mesh.getWorldPosition(_iw);
    const size = 2 * _eye.distanceTo(_iw) * Math.tan(THREE.MathUtils.degToRad(ICON_DEG / 2)) * (t === focusTile ? 1 : 0.7);
    if (t.isFloat) {   // unit space inside floatGroup
      const fw = floatGroup.scale.x, fh = floatGroup.scale.y, sx = size / fw, sy = size / fh;
      t.icon.scale.set(sx, sy, 1);
      t.icon.position.set(0.5 - sx / 2 - 0.02 / fw, 0.5 - sy / 2 - 0.02 / fh, ICON_LIFT / Math.max(fw, fh));
    } else {
      const k = 1 / roomScale, sz = size * k, m = 0.02 * k;
      const band = fitBand(t.outline, sz + 2 * m, sz + 2 * m, -Infinity, true);
      t.icon.scale.set(sz, sz, 1);
      if (band) t.icon.position.set(t.mesh.position.x + band.xr - m - sz / 2, t.mesh.position.y + band.y + m + sz / 2, ICON_LIFT * k);
      else t.icon.position.set(t.mesh.position.x, t.mesh.position.y, ICON_LIFT * k);
    }
  }
}

let focusTile = null;
function setFocus(tile) {
  if (focusTile === tile) return;
  if (focusTile) { focusTile.highlight.visible = false; }
  focusTile = tile;
  if (tile) {
    tile.highlight.visible = true; tile.highlight.userData.lit = -1;
    tile.mesh.parent.add(panelMesh);
    placePanel(tile);
    panelMesh.visible = true;
  } else {
    panelMesh.visible = false;
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
  const hit = pickHit();
  const onPanel = hit && hit.object === panelMesh, slot = hit ? hit.object.userData.slot : null, onSlot = !!slot;
  const tile = hit ? (onPanel ? focusTile : onSlot ? null : tileFor(hit.object)) : null;
  if (hit) { hand.dot.position.copy(hit.point); hand.dot.visible = true; hand.beam.scale.z = hit.distance; }
  else { hand.dot.visible = false; hand.beam.scale.z = 10; }
  if (tile && tile !== hand.hovered) setFocus(tile);
  hand.hovered = tile;
  hand.onSlot = onSlot;
  // Beam point in the tile's own plane (metres from the tile centre), for in-screen drags
  let lx = 0, ly = 0;
  if (tile && !onPanel) {
    _lp.copy(hit.point);
    if (tile.isFloat) { floatGroup.worldToLocal(_lp); lx = _lp.x; ly = _lp.y; }   // unit coords on the float
    else { tile.mesh.parent.worldToLocal(_lp); lx = _lp.x - tile.mesh.position.x; ly = _lp.y - tile.mesh.position.y; }
  }
  if (hand.drag) adjustDrag(hand, tile, lx, ly, hit);
  const btn = onPanel ? panelButtonAt(hit.uv) : -1;
  if (btn !== panelHoverBtn) { panelHoverBtn = btn; if (focusTile) drawPanel(focusTile); }

  const gp = hand.source.gamepad; if (!gp) return;
  // Trigger on a panel button: do that and nothing else this press (hold buttons fire after HOLD_MS on the same button)
  const trigDown = !!(gp.buttons[0] && gp.buttons[0].pressed);
  if (btn >= 0 && trigDown && !hand.prev.trigger) {
    if (panelBtns[btn].hold) hand.hold = { idx: btn, t0: now }; else pressPanelButton(tile, btn);
    hand.prev.trigger = true; return;
  }
  if (hand.hold) {
    if (!trigDown || btn !== hand.hold.idx) { hand.hold = null; setPanelHold(null); }
    else {
      const f = (now - hand.hold.t0) / HOLD_MS;
      setPanelHold(btn, f);
      if (f >= 1) { hand.hold = null; setPanelHold(null); pressPanelButton(tile, btn); }
      hand.prev.trigger = true; return;
    }
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
  // Trigger (without grip) + stick: left/right = turn in place, up/down = tilt the room about you.
  // "Turning" setting: smooth (speed follows deflection) or snap (one step per stick flick).
  if (trigger && !grip && stickActive) {
    if (hand.drag) cancelDrag(hand);
    hand.turning = true;
    const horiz = Math.abs(ax) >= Math.abs(ay);
    if ($('turnMode').value === 'snap') {
      if (!hand.snapped && Math.max(Math.abs(ax), Math.abs(ay)) > 0.6) {
        hand.snapped = true;
        if (horiz) turnRig(-Math.sign(ax) * SNAP_ANGLE); else pitchRoom(-Math.sign(ay) * SNAP_ANGLE);
      }
    } else {
      const n = ((horiz ? Math.abs(ax) : Math.abs(ay)) - dz) / (1 - dz);
      if (horiz) turnRig(-Math.sign(ax) * n * n * TURN_SPEED * dt); else pitchRoom(-Math.sign(ay) * n * n * TURN_SPEED * dt);
    }
  }
  if (Math.max(Math.abs(ax), Math.abs(ay)) < 0.3) hand.snapped = false;
  if (!trigger && p.trigger) hand.turning = false;
  if (grip && stick && !p.stick) recentre();                            // grip + stick click = back to centre
  else if (hand.drag && hand.drag.kind === 'swap' && stick && !p.stick) {   // stick click while trigger-dragging = reset pan/zoom (or the float's pose)
    if (hand.drag.from.isFloat) resetFloatPose();
    else resetView(hand.drag.from);
    hand.drag.adjusted = true;
  }
  else if (tile && stick && !p.stick) jumpRandom(tile);
  if (!grip && p.grip) hand.walking = false;

  // Press on a screen starts a potential drag; release decides: same screen = tap action,
  // different screen = two-screen action (trigger drag = swap places, grip drag = copy).
  if (trigger && !p.trigger && tile) startDrag(hand, 'swap', tile, now, lx, ly, hit);
  if (trigger && !p.trigger && slot === 'liked') startDrag(hand, 'liked', BOARD_SLOT, now);
  if (trigger && !p.trigger && slot === 'shuffle') hand.tapShuffle = true;         // tap (press + release on the slot) = shuffle, pinned screens stay
  if (!trigger && p.trigger && hand.tapShuffle) { hand.tapShuffle = false; if (slot === 'shuffle') dealRandom(); }
  if (grip && !p.grip && tile) startDrag(hand, 'copy', tile, now, lx, ly, hit);
  if (!trigger && p.trigger && hand.drag && (hand.drag.kind === 'swap' || hand.drag.kind === 'liked')) endDrag(hand, tile, now);
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
const SNAP_ANGLE = THREE.MathUtils.degToRad(15);
// Tilt the room about the viewer's head, around the head's left-right axis (stick forward = wall ahead rolls up over you).
function pitchRoom(angle) {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(_head);
  cam.getWorldDirection(_hf); _hf.y = 0;
  if (_hf.lengthSq() < 1e-4) _hf.set(0, 0, -1); else _hf.normalize();
  _hr.set(-_hf.z, 0, _hf.x);
  _rot.setFromAxisAngle(_hr, angle);
  roomGroup.position.sub(_head).applyQuaternion(_rot).add(_head);
  roomGroup.quaternion.premultiply(_rot);
  clampRig();
}
// Put the viewer's head at the room's centre and level the room again
function recentre() {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(_head);
  roomGroup.quaternion.identity(); roomGroup.position.y = 0;
  rig.position.x += roomGroup.position.x - _head.x;
  rig.position.z += roomGroup.position.z - _head.z;
  rig.position.y = 0;
}
function clampRig() {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(_head);
  const m = 0.25 / roomScale, level = roomLevel();
  // Work in unscaled room-local space. Level room: walls only, pushed horizontally (sloped faces must not lift you),
  // floor/ceiling via the vertical rule below. Tilted room: every plane, pushed along its normal.
  toRoomLocal(_head, _lv);
  const planes = level ? wallPlanes() : roomPlanes();
  for (let pass = 0; pass < 2; pass++) for (const p of planes) {   // two passes settle corners
    const lim = p.dist - m;
    const d = _lv.x * p.nx + (_lv.y - polyCentreY) * p.ny + _lv.z * p.nz;
    if (d <= lim) continue;
    if (level) { const hz = Math.hypot(p.nx, p.nz); if (hz > 0.35) { const t = (d - lim) / hz; _lv.x -= t * p.nx / hz; _lv.z -= t * p.nz / hz; } }
    else { _lv.x -= (d - lim) * p.nx; _lv.y -= (d - lim) * p.ny; _lv.z -= (d - lim) * p.nz; }
  }
  fromRoomLocal(_lv, _lv2);
  rig.position.add(_lv2.sub(_head));
  if (!level) return;
  // Vertical (level room only): never below your real standing height, never through the ceiling
  cam.getWorldPosition(_head);
  const headAboveRig = _head.y - rig.position.y;
  const minY = 0, maxY = Math.max(0, roomGroup.position.y + H * roomScale - 0.25 - headAboveRig);
  rig.position.y = Math.max(minY, Math.min(maxY, rig.position.y));
}
function cancelDrag(hand) {
  hand.drag = null;
  hand.beam.material.color.setHex(DRAG_COLORS.idle);
}

const DRAG_COLORS = { swap: 0xffa040, copy: 0x4aff8a, idle: 0x4aa8ff, liked: 0xff4a6a };
const _lp = new THREE.Vector3();
function startDrag(hand, kind, tile, now, lx = 0, ly = 0, hit = null) {
  hand.drag = { kind, from: tile, t0: now, x0: lx, y0: ly, view0: tile.view ? { ...tile.view } : null, adjusted: false, left: false };
  if (tile.isFloat && hit) { const d = hand.drag; d.dist = hit.distance; d.s0 = floatGroup.scale.clone(); d.up0 = floatUp(hit.point); }
  hand.beam.material.color.setHex(DRAG_COLORS[kind]);
  if (kind === 'copy') hand.gripDownAt = now;
}
// While a drag stays on the screen it started on, beam movement pans (trigger) or zooms (grip) that screen's
// video. Leaving the screen reverts the adjustment and the drag becomes the usual swap/copy gesture.
// Height of a world point above the float's centre, along the float's up axis (metres)
const _fu = new THREE.Vector3(), _fo = new THREE.Vector3();
function floatUp(point) { _fu.set(0, 1, 0).applyQuaternion(floatGroup.quaternion); return _fo.copy(point).sub(floatGroup.position).dot(_fu); }
// Drags on the focus screen: trigger moves it (the grabbed point stays under the beam, the screen keeps facing you),
// grip scales it (beam up = bigger). Either marks the float as custom so it stops auto-sizing.
function adjustFloat(hand, tile, lx, ly, hit) {
  const d = hand.drag;
  if (tile !== floatTile || !hit) { d.left = true; return; }
  if (d.left) { d.x0 = lx; d.y0 = ly; d.dist = hit.distance; d.s0 = floatGroup.scale.clone(); d.up0 = floatUp(hit.point); d.left = false; }
  const dx = (lx - d.x0) * d.s0.x, dy = (ly - d.y0) * d.s0.y;
  if (!d.adjusted && Math.hypot(dx, dy) < 0.05 * Math.min(d.s0.x, d.s0.y)) return;
  d.adjusted = true; floatTile.custom = true;
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(_eye);
  if (d.kind === 'swap') {
    // where the grabbed point should be now, then back off by the grab offset (in the float's own frame)
    _fo.copy(raycaster.ray.direction).multiplyScalar(d.dist).add(raycaster.ray.origin);
    _fu.set(d.x0 * floatGroup.scale.x, d.y0 * floatGroup.scale.y, 0).applyQuaternion(floatGroup.quaternion);
    floatGroup.position.copy(_fo).sub(_fu);
    floatGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(_eye, floatGroup.position, new THREE.Vector3(0, 1, 0)));
  } else {
    const k = Math.pow(2, (floatUp(hit.point) - d.up0) / d.s0.y);
    scaleFloat(d.s0.x * k);
  }
}
function adjustDrag(hand, tile, lx, ly, hit) {
  const d = hand.drag, f = d.from;
  if (f.isBoard) return;
  if (f.isFloat) return adjustFloat(hand, tile, lx, ly, hit);
  if (!f.fit) return;
  if (tile !== f) { if (d.adjusted) { f.view = d.view0; refitTile(f); d.adjusted = false; } d.left = true; return; }
  if (d.left) { d.x0 = lx; d.y0 = ly; d.left = false; }
  const dx = lx - d.x0, dy = ly - d.y0;
  if (!d.adjusted && Math.hypot(dx, dy) < 0.05 * Math.min(f.w, f.h)) return;
  d.adjusted = true;
  const v0 = d.view0 || { zoom: null, dx: 0, dy: 0 }, fit = f.fit;
  if (d.kind === 'swap') f.view = { zoom: v0.zoom, dx: v0.dx + dx / fit.vw, dy: v0.dy + dy / fit.vh };
  else { const z0 = v0.zoom != null ? v0.zoom : fit.zoomDefault; f.view = { zoom: Math.max(1, Math.min(2 * fit.coverRatio, z0 * Math.pow(2, dy / f.h))), dx: v0.dx, dy: v0.dy }; }
  refitTile(f);
}
function endDrag(hand, target, now) {
  const { kind, from, t0, adjusted } = hand.drag;
  hand.drag = null;
  hand.beam.material.color.setHex(DRAG_COLORS.idle);
  if (kind === 'liked') { if (target) deployLiked(target); return; }   // dragged from the station board
  if (adjusted) return;   // the press was a pan/zoom (or a reset): no tap or two-screen action
  if (target && target !== from) {
    if (kind === 'swap') swapPlaces(from, target); else copyTo(from, target);
  } else if (target === from) {
    if (kind === 'swap') { if (tilePinned(from)) setStatus('Pinned: this screen keeps its video.'); else swapTile(from); }
    else toggleAudio(from, now - t0 >= LONG_GRIP_MS);
  }
}
// Pick in layers that match the draw order, not by distance: the station board slot and the button panel first,
// then the focus screen (it draws over the room even when it sits beyond a wall), then the room's screens.
function pickHit() {
  const layers = [];
  if (renderer.xr.isPresenting) layers.push(boardSlots);
  if (panelMesh.visible) layers.push([panelMesh]);
  if (focused && !anim) layers.push([floatMesh]);
  const room = tiles.map(x => x.mesh);
  for (const x of tiles) if (x.hit) room.push(x.hit);
  layers.push(room);
  for (const l of layers) { const hit = raycaster.intersectObjects(l, false)[0]; if (hit) return hit; }
  return undefined;
}
function tileFor(obj) { return obj === floatMesh ? floatTile : tileOf.get(obj); }

// ---- Desktop: mouse look + hover + actions ----
let yaw = 0, pitch = 0, dragging = false, downX = 0, downY = 0, moved = false;
const mouse = new THREE.Vector2(2, 2);
let mouseTile = null;
let mouseHold = null;   // { idx, t0 } while the mouse button is held on a hold button
renderer.domElement.addEventListener('pointerdown', e => {
  dragging = true; moved = false; downX = e.clientX; downY = e.clientY;
  if (e.button === 0 && mouseTile && panelHoverBtn >= 0 && panelBtns[panelHoverBtn].hold) mouseHold = { idx: panelHoverBtn, t0: performance.now() };
});
addEventListener('pointerup', e => {
  dragging = false;
  const held = mouseHold; mouseHold = null;
  if (held) { if (!held.fired) setPanelHold(null); return; }   // released early, or it already fired: no click
  if (e.target !== renderer.domElement || renderer.xr.isPresenting) return;
  if (moved) return;
  if (e.button === 0 && mouseTile && panelHoverBtn >= 0) { pressPanelButton(mouseTile, panelHoverBtn); return; }
  if (e.button === 0 && mouseTile && !tilePinned(mouseTile)) swapTile(mouseTile);
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
    if (!marked) { marked = mouseTile; setStatus(`Marked "${tileName(mouseTile.label)}". Hover another screen and press X to swap or C to copy.`); }
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
  const hit = pickHit();
  const onPanel = hit && hit.object === panelMesh;
  const tile = hit ? (onPanel ? focusTile : tileFor(hit.object)) : null;
  if (tile !== mouseTile) { mouseTile = tile; setFocus(tile); }
  const btn = onPanel ? panelButtonAt(hit.uv) : -1;
  if (btn !== panelHoverBtn) { panelHoverBtn = btn; if (focusTile) drawPanel(focusTile); }
  if (mouseHold && !mouseHold.fired) {
    if (btn !== mouseHold.idx || !tile) { mouseHold = null; setPanelHold(null); }
    else {
      const f = (performance.now() - mouseHold.t0) / HOLD_MS;
      setPanelHold(btn, f);
      if (f >= 1) { mouseHold = { fired: true }; setPanelHold(null); pressPanelButton(tile, btn); }   // the release is swallowed
    }
  }
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
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1), now = performance.now();
  frames++;
  updateFocusAnim(now);
  updateTransitions(now);
  if (renderer.xr.isPresenting) for (const h of hands) updateHand(h, dt, now);
  else { updateMouse(); updateDesktopWalk(dt); }
  updateHud();
  updateBoard(dt);
  boardHot = hands.some(h => h.onSlot || (h.drag && h.drag.kind === 'liked'));
  renderer.render(scene, camera);
});
