/* Local Stack Reader worker — runs card-index detection (detect.js) +
 * IndexNet ONNX classification fully in the browser. Zero API calls.
 *
 * In:  {id, width, height, data: ArrayBuffer (RGBA)}   (transferable)
 *      {type: "config", scoreMin, gapMin}
 * Out: {id, codes: ["KC","GAP",...], nCandidates, nConfident, ms}
 *      {type: "ready"} once the model is warm, or {type: "fail", error}
 */
"use strict";

importScripts("detect.js");
importScripts("ort.min.js");

ort.env.wasm.wasmPaths = self.location.href.replace(/[^/]*$/, "");
ort.env.wasm.numThreads = 1;   // no SharedArrayBuffer/COEP requirement

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["S", "H", "D", "C"];
const CLASSES = [];
for (const s of SUITS) for (const r of RANKS) CLASSES.push(r + s);
CLASSES.push("neg");
const N_CLASSES = CLASSES.length;
const CROP_SZ = self.LocalDetect.CROP;

let scoreMin = 0.85;
let gapMin = 0.5;

const sessPromise = ort.InferenceSession.create(
  ort.env.wasm.wasmPaths + "classifier.onnx",
  { executionProviders: ["wasm"] }
).then(async (sess) => {
  // warm-up run so first real frame isn't slow
  const dummy = new ort.Tensor("float32", new Float32Array(CROP_SZ * CROP_SZ), [1, 1, CROP_SZ, CROP_SZ]);
  await sess.run({ crop: dummy });
  postMessage({ type: "ready" });
  return sess;
}).catch((e) => {
  postMessage({ type: "fail", error: String(e) });
  return null;
});

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "config") {
    if (typeof msg.scoreMin === "number") scoreMin = msg.scoreMin;
    if (typeof msg.gapMin === "number") gapMin = msg.gapMin;
    return;
  }
  const sess = await sessPromise;
  if (!sess) {
    postMessage({ id: msg.id, codes: null, error: "no-model" });
    return;
  }
  const t0 = performance.now();
  try {
    const frame = {
      data: new Uint8ClampedArray(msg.data),
      width: msg.width,
      height: msg.height,
    };
    const { candidates } = self.LocalDetect.detectCandidates(frame);
    if (!candidates.length) {
      postMessage({ id: msg.id, codes: [], nCandidates: 0, nConfident: 0,
                    ms: performance.now() - t0 });
      return;
    }
    const n = candidates.length;
    const input = new Float32Array(n * CROP_SZ * CROP_SZ);
    candidates.forEach((c, i) => input.set(c.crop, i * CROP_SZ * CROP_SZ));
    const out = await sess.run({
      crop: new ort.Tensor("float32", input, [n, 1, CROP_SZ, CROP_SZ]),
    });
    const logits = out.logits.data;
    const reads = [];
    for (let i = 0; i < n; i++) {
      let mx = -Infinity;
      for (let k = 0; k < N_CLASSES; k++) mx = Math.max(mx, logits[i * N_CLASSES + k]);
      let sum = 0;
      const p = new Float64Array(N_CLASSES);
      for (let k = 0; k < N_CLASSES; k++) {
        p[k] = Math.exp(logits[i * N_CLASSES + k] - mx);
        sum += p[k];
      }
      let best = 0, second = -1;
      for (let k = 0; k < N_CLASSES; k++) {
        p[k] /= sum;
        if (k === best) continue;
        if (p[k] > p[best]) { second = best; best = k; }
        else if (second < 0 || p[k] > p[second]) second = k;
      }
      if (CLASSES[best] === "neg") continue;
      reads.push({ x: candidates[i].x, code: CLASSES[best],
                   score: p[best], gap: p[best] - (second >= 0 ? p[second] : 0),
                   glyphH: candidates[i].glyphH });
    }
    const { codes, reads: dedup } = self.LocalDetect.buildCodes(reads, scoreMin, gapMin);
    postMessage({ id: msg.id, codes,
                  nCandidates: dedup.length,
                  nConfident: dedup.filter(r => r.ok).length,
                  ms: performance.now() - t0 });
  } catch (err) {
    postMessage({ id: msg.id, codes: null, error: String(err) });
  }
};
