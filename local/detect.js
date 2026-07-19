/* Local card-index detection — dependency-free JS port of
 * magic_pipeline/stack_reader/local_reader.py (detection front-end).
 *
 * Input:  {data: Uint8ClampedArray (RGBA), width, height}  — full frame
 * Output: candidates [{x, y, glyphH, angle, crop: Float32Array(64*64)}]
 *         where crop is normalized to [-1, 1] for the IndexNet ONNX model,
 *         plus the band offset so x maps back to frame coords.
 *
 * Runs in a Web Worker (no DOM). Kernel approximations vs OpenCV:
 * Gaussian ≈ 3x box blur, ellipse morphology ≈ separable square — the
 * classifier absorbs the small differences (validated on the eval set).
 */
"use strict";

const CANON_W = 120, CANON_H = 180;   // template-scale corner window
const CROP = 64;                      // classifier input size

/* Template geometry measured from card_refs (Python template_geometry()):
 * baked in so the browser needs no refs.json. */
const TMPL_GLYPH = 86.0;
const INK_X0 = 15, INK_Y0 = 10, INK_X1 = 103, INK_Y1 = 170;

/* ─── small image ops on Float32/Uint8 planes ─── */

function boxBlurH(src, dst, w, h, r) {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * norm;
      const xAdd = Math.min(w - 1, x + r + 1);
      const xSub = Math.max(0, x - r);
      acc += src[row + xAdd] - src[row + xSub];
    }
  }
}

function boxBlurV(src, dst, w, h, r) {
  const norm = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += src[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * norm;
      const yAdd = Math.min(h - 1, y + r + 1);
      const ySub = Math.max(0, y - r);
      acc += src[yAdd * w + x] - src[ySub * w + x];
    }
  }
}

function gaussianBlur(plane, w, h, sigma) {
  // 3 successive box blurs approximate a Gaussian (Wells '86)
  const r = Math.max(1, Math.round(sigma * 0.8));
  const a = new Float32Array(plane.length);
  const b = new Float32Array(plane.length);
  boxBlurH(plane, a, w, h, r); boxBlurV(a, b, w, h, r);
  boxBlurH(b, a, w, h, r); boxBlurV(a, b, w, h, r);
  boxBlurH(b, a, w, h, r); boxBlurV(a, b, w, h, r);
  return b;
}

/* separable min/max filter (square structuring element radius r) */
function morph(mask, w, h, r, isMax) {
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = isMax ? 0 : 1;
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      for (let i = x0; i <= x1; i++) {
        const p = mask[row + i];
        if (isMax ? p > v : p < v) v = p;
        if (isMax ? v === 1 : v === 0) break;
      }
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = isMax ? 0 : 1;
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let i = y0; i <= y1; i++) {
        const p = tmp[i * w + x];
        if (isMax ? p > v : p < v) v = p;
        if (isMax ? v === 1 : v === 0) break;
      }
      out[y * w + x] = v;
    }
  }
  return out;
}
const erode = (m, w, h, r) => morph(m, w, h, r, false);
const dilate = (m, w, h, r) => morph(m, w, h, r, true);
const morphOpen = (m, w, h, r) => dilate(erode(m, w, h, r), w, h, r);
const morphClose = (m, w, h, r) => erode(dilate(m, w, h, r), w, h, r);

/* connected components with stats (4-connectivity, BFS) */
function components(mask, w, h) {
  const labels = new Int32Array(w * h);
  const stats = [];   // {x, y, w, h, area, cx, cy}
  const qx = new Int32Array(w * h), qy = new Int32Array(w * h);
  let next = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!mask[idx] || labels[idx]) continue;
      let head = 0, tail = 0;
      qx[tail] = x; qy[tail] = y; tail++;
      labels[idx] = next;
      let minX = x, maxX = x, minY = y, maxY = y, area = 0, sx = 0, sy = 0;
      while (head < tail) {
        const px = qx[head], py = qy[head]; head++;
        area++; sx += px; sy += py;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        if (px > 0) { const i2 = py * w + px - 1; if (mask[i2] && !labels[i2]) { labels[i2] = next; qx[tail] = px - 1; qy[tail] = py; tail++; } }
        if (px < w - 1) { const i2 = py * w + px + 1; if (mask[i2] && !labels[i2]) { labels[i2] = next; qx[tail] = px + 1; qy[tail] = py; tail++; } }
        if (py > 0) { const i2 = (py - 1) * w + px; if (mask[i2] && !labels[i2]) { labels[i2] = next; qx[tail] = px; qy[tail] = py - 1; tail++; } }
        if (py < h - 1) { const i2 = (py + 1) * w + px; if (mask[i2] && !labels[i2]) { labels[i2] = next; qx[tail] = px; qy[tail] = py + 1; tail++; } }
      }
      stats.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
                   area, cx: sx / area, cy: sy / area, label: next });
      next++;
    }
  }
  return { labels, stats };
}

/* Otsu threshold on a grayscale ROI (Float32Array) */
function otsuInv(roi) {
  const hist = new Float64Array(256);
  for (let i = 0; i < roi.length; i++) hist[Math.min(255, Math.max(0, roi[i] | 0))]++;
  const total = roi.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = -1, thresh = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; thresh = t; }
  }
  const out = new Uint8Array(roi.length);
  for (let i = 0; i < roi.length; i++) out[i] = roi[i] <= thresh ? 1 : 0;
  return out;
}

/* ─── plane extraction (RGBA -> V, S, gray as Float32) ─── */

function planes(frame) {
  const { data, width: w, height: h } = frame;
  const n = w * h;
  const V = new Float32Array(n), S = new Float32Array(n), G = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    V[i] = mx;
    S[i] = mx === 0 ? 0 : 255 * (mx - mn) / mx;
    G[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return { V, S, G, w, h };
}

/* ─── band crop (port of crop_card_band) ─── */

function cropBand(p) {
  const { V, S, w, h } = p;
  const bg = gaussianBlur(V, w, h, w / 20);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    mask[i] = (V[i] / Math.max(bg[i], 1) > 1.12 && S[i] < 70) ? 1 : 0;
  }
  let m = morphOpen(mask, w, h, 4);
  const big = morphClose(m, w, h, 15);
  const { stats } = components(big, w, h);
  if (!stats.length) return { x0: 0, y0: 0, x1: w, y1: h };
  let main = stats[0];
  for (const s of stats) if (s.area > main.area) main = s;
  let x0 = main.x, y0 = main.y, x1 = main.x + main.w, y1 = main.y + main.h;
  for (const s of stats) {
    if (s === main || s.area < 0.03 * main.area) continue;
    if (s.x < x1 + main.w * 0.5 && s.x + s.w > x0 - main.w * 0.5 &&
        s.y < y1 + main.h * 0.5 && s.y + s.h > y0 - main.h * 0.5) {
      x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y);
      x1 = Math.max(x1, s.x + s.w); y1 = Math.max(y1, s.y + s.h);
    }
  }
  const padY = Math.round((y1 - y0) * 0.10), padX = Math.round((x1 - x0) * 0.03);
  return { x0: Math.max(0, x0 - padX), y0: Math.max(0, y0 - padY),
           x1: Math.min(w, x1 + padX), y1: Math.min(h, y1 + padY) };
}

function subPlanes(p, box) {
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const V = new Float32Array(bw * bh), S = new Float32Array(bw * bh),
        G = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    const src = (y + box.y0) * p.w + box.x0, dst = y * bw;
    for (let x = 0; x < bw; x++) {
      V[dst + x] = p.V[src + x]; S[dst + x] = p.S[src + x]; G[dst + x] = p.G[src + x];
    }
  }
  return { V, S, G, w: bw, h: bh };
}

/* ─── bilinear sample with rotation for the final crop ─── */

function sampleCrop(G, w, h, cx, cy, angDeg, spanX, spanY, out) {
  // out: CROP x CROP window covering spanX x spanY source pixels (the
  // template window's aspect squished to square, matching the training
  // crops), rotated around (cx, cy) so the card is upright
  const a = angDeg * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const stepX = spanX / CROP, stepY = spanY / CROP;
  for (let oy = 0; oy < CROP; oy++) {
    for (let ox = 0; ox < CROP; ox++) {
      const dx = (ox - CROP / 2) * stepX, dy = (oy - CROP / 2) * stepY;
      // rotate by +ang (same direction as cv2.getRotationMatrix2D(ang))
      const sx = cx + dx * cos - dy * sin;
      const sy = cy + dx * sin + dy * cos;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const xa = Math.min(w - 1, Math.max(0, x0));
      const xb = Math.min(w - 1, Math.max(0, x0 + 1));
      const ya = Math.min(h - 1, Math.max(0, y0));
      const yb = Math.min(h - 1, Math.max(0, y0 + 1));
      const v = G[ya * w + xa] * (1 - fx) * (1 - fy) + G[ya * w + xb] * fx * (1 - fy) +
                G[yb * w + xa] * (1 - fx) * fy + G[yb * w + xb] * fx * fy;
      out[oy * CROP + ox] = v / 127.5 - 1.0;
    }
  }
}

/* ─── main detection (port of detect_candidates) ─── */

function detectCandidates(frame) {
  const full = planes(frame);
  const box = cropBand(full);
  const p = subPlanes(full, box);
  const { V, S, G, w, h } = p;
  const n = w * h;

  // card white
  const white = new Uint8Array(n);
  for (let i = 0; i < n; i++) white[i] = (V[i] > 180 && S[i] < 60) ? 1 : 0;

  // ink: darker than local bg, or vividly red
  const bg = gaussianBlur(V, w, h, Math.max(3, w / 60));
  let ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    ink[i] = (V[i] < bg[i] * 0.80 || (S[i] > 95 && V[i] > 60)) ? 1 : 0;
  }
  ink = morphOpen(ink, w, h, 1);

  const { stats } = components(ink, w, h);
  const minH = Math.max(9, h * 0.012), maxH = h * 0.18;
  let blobs = [];
  for (const st of stats) {
    if (st.h < minH || st.h > maxH) continue;
    if (st.w > h * 0.18 || st.area < 25) continue;
    if (st.area / (st.w * st.h) < 0.12) continue;
    const m = Math.max(4, Math.round(st.h * 0.6));
    const x0 = Math.max(0, st.x - m), y0 = Math.max(0, st.y - m);
    const x1 = Math.min(w, st.x + st.w + m), y1 = Math.min(h, st.y + st.h + m);
    let wsum = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) wsum += white[y * w + x];
    if (wsum / ((x1 - x0) * (y1 - y0)) < 0.14) continue;
    blobs.push({ x: st.x, y: st.y, w: st.w, h: st.h, cx: st.cx, cy: st.cy });
  }
  if (!blobs.length) return { candidates: [], band: box };

  // merge near-touching fragments (union-find)
  const parent = blobs.map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const bi = blobs[i], bj = blobs[j];
      const gx = Math.max(bi.x, bj.x) - Math.min(bi.x + bi.w, bj.x + bj.w);
      const gy = Math.max(bi.y, bj.y) - Math.min(bi.y + bi.h, bj.y + bj.h);
      const lim = 0.30 * Math.max(bi.h, bj.h);
      if (gx < lim && gy < lim * 0.6) {
        const ri = find(i), rj = find(j);
        if (ri !== rj) parent[ri] = rj;
      }
    }
  }
  const groupMap = new Map();
  blobs.forEach((b, i) => {
    const r = find(i);
    if (!groupMap.has(r)) groupMap.set(r, []);
    groupMap.get(r).push(b);
  });
  blobs = [...groupMap.values()].map(ms => {
    const x0 = Math.min(...ms.map(b => b.x)), y0 = Math.min(...ms.map(b => b.y));
    const x1 = Math.max(...ms.map(b => b.x + b.w)), y1 = Math.max(...ms.map(b => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  });

  // arc centroid fit (quadratic through white-mask column centroids)
  const colMass = new Float32Array(w), colYSum = new Float32Array(w);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (white[y * w + x]) { colMass[x]++; colYSum[x] += y; }
  let cmax = 0;
  for (let x = 0; x < w; x++) if (colMass[x] > cmax) cmax = colMass[x];
  const xs = [], ys = [];
  for (let x = 0; x < w; x += 8) {
    if (colMass[x] > cmax * 0.10) { xs.push(x); ys.push(colYSum[x] / colMass[x]); }
  }
  let centroidAt = () => h, angleAt = () => 0;
  if (xs.length >= 10) {
    // least-squares quadratic fit
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i], y = ys[i], x2 = x * x;
      s0++; s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2;
      t0 += y; t1 += x * y; t2 += x2 * y;
    }
    // solve [[s4 s3 s2][s3 s2 s1][s2 s1 s0]] [a b c] = [t2 t1 t0]
    const det = s4 * (s2 * s0 - s1 * s1) - s3 * (s3 * s0 - s1 * s2) + s2 * (s3 * s1 - s2 * s2);
    if (Math.abs(det) > 1e-6) {
      const a = (t2 * (s2 * s0 - s1 * s1) - s3 * (t1 * s0 - t0 * s1) + s2 * (t1 * s1 - t0 * s2)) / det;
      const b = (s4 * (t1 * s0 - t0 * s1) - t2 * (s3 * s0 - s1 * s2) + s2 * (s3 * t0 - s2 * t1)) / det;
      const c = (s4 * (s2 * t0 - t1 * s1) - s3 * (s3 * t0 - t1 * s2) + t2 * (s3 * s1 - s2 * s2)) / det;
      centroidAt = (x) => a * x * x + b * x + c;
      angleAt = (x) => Math.atan(2 * a * x + b) * 180 / Math.PI;
    }
  }

  // glyph-size anchor from card height
  const busy = [];
  for (let x = 0; x < w; x++) if (colMass[x] > 0.3 * cmax) busy.push(colMass[x]);
  busy.sort((a, b) => a - b);
  let glyphEst = busy.length ? 0.105 * busy[Math.floor(busy.length * 0.8)] : 0;
  if (glyphEst <= minH) {
    const hs = blobs.map(b => b.h).sort((a, b) => a - b);
    glyphEst = hs[Math.floor(hs.length / 2)] || minH;
  }

  const ranks = blobs.filter(b =>
    b.h >= 0.55 * glyphEst && b.h <= 1.55 * glyphEst &&
    b.w <= 1.4 * glyphEst && b.cy <= centroidAt(b.cx));

  // refine rank glyph extent with Otsu in a local ROI
  const refine = (b) => {
    const m = Math.round(b.h * 0.8);
    const x0 = Math.max(0, b.x - m), y0 = Math.max(0, b.y - m);
    const x1 = Math.min(w, b.x + b.w + m), y1 = Math.min(h, b.y + b.h + m);
    const rw = x1 - x0, rh = y1 - y0;
    if (rw <= 0 || rh <= 0) return b;
    const roi = new Float32Array(rw * rh);
    for (let y = 0; y < rh; y++)
      for (let x = 0; x < rw; x++) roi[y * rw + x] = G[(y + y0) * w + x + x0];
    const th = otsuInv(roi);
    const cc = components(th, rw, rh);
    let cx = Math.min(rw - 1, Math.max(0, Math.round(b.cx - x0)));
    let cy = Math.min(rh - 1, Math.max(0, Math.round(b.cy - y0)));
    let li = cc.labels[cy * rw + cx];
    if (!li) {
      for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 3], [-3, -3]]) {
        const px = Math.min(rw - 1, Math.max(0, cx + dx));
        const py = Math.min(rh - 1, Math.max(0, cy + dy));
        if (cc.labels[py * rw + px]) { li = cc.labels[py * rw + px]; break; }
      }
    }
    if (!li) return b;
    const st = cc.stats.find(s => s.label === li);
    if (!st || st.h > 2.2 * b.h || st.w > 3.0 * b.w + 8) return b;
    return { x: x0 + st.x, y: y0 + st.y, w: st.w, h: st.h,
             cx: x0 + st.x + st.w / 2, cy: y0 + st.y + st.h / 2 };
  };

  const candidates = [];
  for (const r0 of ranks) {
    const r = refine(r0);
    let suit = null;
    for (const b of blobs) {
      if (b === r0) continue;
      const dy = b.y - (r.y + r.h);
      if (dy < -0.35 * r.h || dy > 1.0 * r.h) continue;
      if (Math.abs(b.cx - r.cx) > 1.1 * r.h) continue;
      if (b.h > 1.25 * r.h || b.h < 0.3 * r.h) continue;
      if (!suit || Math.abs(b.cx - r.cx) < Math.abs(suit.cx - r.cx)) suit = b;
    }
    let px0 = r.x, py0 = r.y, px1 = r.x + r.w, py1;
    if (suit) {
      px0 = Math.min(px0, suit.x);
      px1 = Math.max(px1, suit.x + suit.w);
      py1 = suit.y + suit.h;
    } else {
      py1 = r.y + r.h + 1.05 * r.h;
    }
    const cx = (px0 + px1) / 2, cy = (py0 + py1) / 2;
    const ang = angleAt(cx);
    // Source span: the Python path scales so rank glyph -> 86px inside a
    // (150+slack)x(210+slack) window, then resizes to 64x64. Equivalent
    // single-step: sample a source window of (CANON_W+30)/scale pixels.
    const scale = TMPL_GLYPH / Math.max(r.h, 1);
    const spanX = (CANON_W + 30) / scale;
    const spanY = (CANON_H + 30) / scale;
    const inkCx = (INK_X0 + INK_X1) / 2, inkCy = (INK_Y0 + INK_Y1) / 2;
    // center the sample window where the template ink center would be
    const offX = ((CANON_W + 30) / 2 - (inkCx + 15)) / scale;
    const offY = ((CANON_H + 30) / 2 - (inkCy + 15)) / scale;
    const crop = new Float32Array(CROP * CROP);
    sampleCrop(G, w, h, cx + offX, cy + offY, ang, spanX, spanY, crop);
    candidates.push({ x: cx, y: cy, glyphH: r.h, angle: ang, crop,
                      hasSuit: !!suit });
  }
  candidates.sort((a, b) => a.x - b.x);
  return { candidates, band: box };
}

/* ─── codes assembly (port of build_codes; scores added by classifier) ─── */

function buildCodes(reads, scoreMin, gapMin, gapSpacing = 2.1) {
  for (const r of reads) r.ok = r.score >= scoreMin && r.gap >= gapMin;
  const dedup = [];
  for (const r of reads) {
    const last = dedup[dedup.length - 1];
    if (last && r.code === last.code && Math.abs(r.x - last.x) < 2.5 * r.glyphH) {
      if (r.score > last.score) dedup[dedup.length - 1] = r;
      continue;
    }
    dedup.push(r);
  }
  const xs = dedup.map(r => r.x);
  const spacings = xs.slice(1).map((x, i) => x - xs[i]);
  const medSp = spacings.length ?
    spacings.slice().sort((a, b) => a - b)[Math.floor(spacings.length / 2)] : 0;
  const codes = [];
  dedup.forEach((r, i) => {
    if (i && medSp > 0 && (r.x - dedup[i - 1].x) > gapSpacing * medSp) codes.push("GAP");
    codes.push(r.ok ? r.code : "GAP");
  });
  const out = [];
  for (const c of codes) {
    if (c === "GAP" && out[out.length - 1] === "GAP") continue;
    out.push(c);
  }
  while (out[0] === "GAP") out.shift();
  while (out[out.length - 1] === "GAP") out.pop();
  return { codes: out, reads: dedup };
}

/* exports (worker + node test) */
if (typeof module !== "undefined") {
  module.exports = { detectCandidates, buildCodes, planes, cropBand, CROP };
} else if (typeof self !== "undefined") {
  self.LocalDetect = { detectCandidates, buildCodes, CROP };
}
