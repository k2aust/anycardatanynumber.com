// Stack optimizer: searches for a 52-card order that minimizes dead (card,
// number) pairs under the app's engine, half mode primary. Uses a fast
// arithmetic mirror of findOuts (validated against the real engine before
// searching). Run: node optimize.js [minutes]
const fs = require("fs");
const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const m = html.match(/\/\*ENGINE-START\*\/([\s\S]*?)\/\*ENGINE-END\*\//);
const { STACKS, DEFAULT_SETTINGS, deadNumbers, numberWord, letterCount, cardPhrases } =
  eval("(function () {" + m[1] + "\n;return { STACKS, DEFAULT_SETTINGS, deadNumbers, numberWord, letterCount, cardPhrases };})()");

// ---- card metadata (independent of stack) ----
const CARDS = [...STACKS.aronson].sort(); // canonical card list
const ID = {}; CARDS.forEach((c, i) => ID[c] = i);
const VAL = CARDS.map(c => { const v = parseInt(c.slice(0, -1), 10); return isNaN(v) ? 0 : v; }); // 0 = A/J/Q/K
// spell lengths: [plain B+2 (mod 0), THE B+5 (mod -3), no-of B (mod -5)]
const SPELL = CARDS.map(c => cardPhrases(c).map(ph => ph.letters));
const SPELLMOD = [0, -3, -5];
const LN = [0]; for (let n = 1; n <= 52; n++) LN.push(letterCount(numberWord(n)));

// ---- fast evaluator ----
// at[idx] = card id at position idx+1 (rotation 0). Views per rotation:
// jok 0 none / 1 top / 2 face. Mirrors the engine for single-card input.
function bestForRot(at, posOfCard, c, n, rot) {
  const p = ((posOfCard - 1 - rot + 52) % 52) + 1;
  const Lns = LN[n];
  let best = -1, clean = false;
  const catTop = (q, jok) => { if (jok) { q -= 2; if (q < 1) return -1; } if (q < 1 || q > 52) return -1; return at[(q - 1 + rot) % 52]; };
  const catFace = (q, jok) => { if (jok) { q -= 2; if (q < 1) return -1; } if (q < 1 || q > 52) return -1; return at[(52 - q + rot) % 52]; };
  const upd = (s, cl) => { if (s > best) best = s; if (cl) clean = true; };

  for (let jok = 0; jok <= 2; jok++) {
    const jm = jok ? -10 : 0;
    const ds = jok ? 54 : 52;
    if (jok !== 2) { // top orient
      const ep = p + (jok === 1 ? 2 : 0);
      if (jok === 0 && ep === 1) upd(90, true);
      if (ep === n) upd(100 + jm, true);
      if (ep === n + 1) upd(92 + jm, true);
      if (ep === n - 1) upd(88 + jm, false);
      if (ep === Lns) upd(60 + jm, true);
      if (ep === Lns + 1) upd(52 + jm, true);
      for (let da = 0; da <= 1; da++) {
        const q = n + da, am = da ? -8 : 0;
        const ind = catTop(q, jok === 1);
        if (ind >= 0 && ind !== c && VAL[ind] >= 2) {
          const v = VAL[ind];
          if (ep === q + v) upd(75 + am + jm, true);
          if (ep === q + v - 1) upd(75 + am + jm, true);
        }
      }
      { // indicator back (top only)
        const ind = catTop(n, jok === 1);
        if (ind >= 0 && ind !== c && VAL[ind] >= 2) {
          const v = VAL[ind];
          if (v <= n && ep === n - v + 1) upd(72 + jm, true);
          if (v < n && ep === n - v) upd(72 + jm, true);
          if (v <= n && ep === n - v + 2) upd(60 + jm, false);
        }
      }
      for (let k = 0; k < 3; k++) {
        const L = SPELL[c][k], pm = SPELLMOD[k], cl = k === 0;
        const t = n + L;
        if (t <= ds && ep === t) upd(70 + pm + jm, cl);
        if (t + 1 <= ds && ep === t + 1) upd(62 + pm + jm, cl);
        if (t <= ds && ep === t) upd(68 + pm + jm, cl);
        if (t + 1 <= ds && ep === t + 1) upd(60 + pm + jm, cl);
        if (t - 1 >= 1 && t - 1 <= ds && ep === t - 1) upd(56 + pm + jm, false);
        if (L <= n && ep === n - L + 1) upd(65 + pm + jm, cl);
        if (L + 1 <= n && ep === n - L) upd(57 + pm + jm, cl);
        if (ep === L) upd(40 + pm + jm, cl);
        if (ep === L + 1) upd(32 + pm + jm, cl);
      }
      if (Lns <= n && ep === n - Lns + 1) upd(55 + jm, true);
      if (Lns + 1 <= n && ep === n - Lns) upd(47 + jm, true);
    }
    if (jok !== 1) { // face orient
      const ep = (53 - p) + (jok === 2 ? 2 : 0);
      const fm = -10 + jm;
      if (jok === 0 && ep === 1) upd(90, true);
      if (ep === n) upd(100 + fm, true);
      if (ep === n + 1) upd(92 + fm, true);
      if (ep === Lns) upd(60 + fm, true);
      if (ep === Lns + 1) upd(52 + fm, true);
      for (let da = 0; da <= 1; da++) {
        const q = n + da, am = da ? -8 : 0;
        const ind = catFace(q, jok === 2);
        if (ind >= 0 && ind !== c && VAL[ind] >= 2) {
          const v = VAL[ind];
          if (ep === q + v) upd(75 + am + fm, true);
          if (ep === q + v - 1) upd(75 + am + fm, true);
        }
      }
      for (let k = 0; k < 3; k++) {
        const L = SPELL[c][k], pm = SPELLMOD[k], cl = k === 0;
        const t = n + L;
        if (t <= ds && ep === t) upd(70 + pm + fm, cl);
        if (t + 1 <= ds && ep === t + 1) upd(62 + pm + fm, cl);
        if (L <= n && ep === n - L + 1) upd(65 + pm + fm, cl);
        if (L + 1 <= n && ep === n - L) upd(57 + pm + fm, cl);
        if (ep === L) upd(40 + pm + fm, cl);
        if (ep === L + 1) upd(32 + pm + fm, cl);
      }
      if (Lns <= n && ep === n - Lns + 1) upd(55 + fm, true);
      if (Lns + 1 <= n && ep === n - Lns) upd(47 + fm, true);
    }
  }
  return { best, clean };
}

function evalStack(at) {
  const pos = new Int32Array(52);
  for (let i = 0; i < 52; i++) pos[at[i]] = i + 1;
  let deadH = 0, deadF = 0, deadClean = 0, sumBest = 0, tier90 = 0, tier70 = 0;
  for (let c = 0; c < 52; c++) {
    for (let n = 1; n <= 52; n++) {
      const a = bestForRot(at, pos[c], c, n, 0);
      const b = bestForRot(at, pos[c], c, n, 26);
      const best = Math.max(a.best, b.best);
      if (a.best < 0) deadF++;
      if (best < 0) { deadH++; deadClean++; continue; }
      if (!(a.clean || b.clean)) deadClean++;
      sumBest += best;
      if (best >= 90) tier90++;
      if (best >= 70) tier70++;
    }
  }
  return { deadH, deadF, deadClean, sumBest, tier90, tier70 };
}
// visual tells when spread face up: adjacent same-value pairs, 3-runs of suit,
// adjacent consecutive values of the same suit
function suspicion(at) {
  let s = 0;
  const v = i => CARDS[at[i]].slice(0, -1), su = i => CARDS[at[i]].slice(-1);
  const ord = { A:1,"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,J:11,Q:12,K:13 };
  for (let i = 0; i < 51; i++) {
    if (v(i) === v(i + 1)) s++;
    if (su(i) === su(i + 1) && Math.abs(ord[v(i)] - ord[v(i + 1)]) === 1) s++;
    if (i < 50 && su(i) === su(i + 1) && su(i + 1) === su(i + 2)) s++;
  }
  // same value within distance 2 (e.g. Q . Q)
  for (let i = 0; i < 50; i++) if (v(i) === v(i + 2)) s++;
  return s;
}
const objective = (r, at) => r.deadH * 1e10 + r.deadClean * 1e7 + (at ? suspicion(at) * 3e5 : 0) + r.deadF * 1e4 - r.sumBest;

// ---- validation against the real engine ----
function engineDead(stackKey, mode) {
  const S = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  S.stack = stackKey; S.topCard = STACKS[stackKey][0]; S.mode = mode;
  const out = {};
  for (const c of STACKS[stackKey]) out[c] = deadNumbers(c, S);
  return out;
}
function fastDead(at, half) {
  const pos = new Int32Array(52);
  for (let i = 0; i < 52; i++) pos[at[i]] = i + 1;
  const out = {};
  for (let c = 0; c < 52; c++) {
    const dead = [];
    for (let n = 1; n <= 52; n++) {
      let best = bestForRot(at, pos[c], c, n, 0).best;
      if (half && best < 0) best = bestForRot(at, pos[c], c, n, 26).best;
      if (best < 0) dead.push(n);
    }
    out[CARDS[c]] = dead;
  }
  return out;
}
function validate(stackKey, mode) {
  const at = STACKS[stackKey].map(c => ID[c]);
  const eng = engineDead(stackKey, mode), fast = fastDead(at, mode === "half");
  for (const c of STACKS[stackKey]) {
    if (JSON.stringify(eng[c]) !== JSON.stringify(fast[c])) {
      console.error(`MISMATCH ${stackKey}/${mode} ${c}: engine=[${eng[c]}] fast=[${fast[c]}]`);
      return false;
    }
  }
  console.log(`validated ${stackKey}/${mode}: fast evaluator matches engine exactly`);
  return true;
}

// ---- search ----
function report(label, at) {
  const r = evalStack(at);
  console.log(`${label}: deadHalf=${r.deadH} deadCleanHalf=${r.deadClean} deadFull=${r.deadF} ` +
    `90+=${(100 * r.tier90 / 2704).toFixed(1)}% 70+=${(100 * r.tier70 / 2704).toFixed(1)}% avgBest=${(r.sumBest / (2704 - r.deadH)).toFixed(1)}`);
  return r;
}

function anneal(start, minutes) {
  let at = [...start], cur = objective(evalStack(at), at);
  let bestAt = [...at], bestObj = cur;
  const end = Date.now() + minutes * 60000;
  let T = 3e7, iters = 0;
  const decay = () => { T = Math.max(2e3, T * 0.99996); };
  while (Date.now() < end) {
    iters++;
    const i = (Math.random() * 52) | 0; let j = (Math.random() * 52) | 0;
    if (i === j) j = (j + 1) % 52;
    [at[i], at[j]] = [at[j], at[i]];
    const o = objective(evalStack(at), at);
    if (o <= cur || Math.random() < Math.exp((cur - o) / T)) {
      cur = o;
      if (o < bestObj) { bestObj = o; bestAt = [...at]; }
    } else {
      [at[i], at[j]] = [at[j], at[i]];
    }
    decay();
  }
  console.log(`anneal: ${iters} iterations`);
  return bestAt;
}

function polish(at) {
  let cur = objective(evalStack(at), at), improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < 51; i++) for (let j = i + 1; j < 52; j++) {
      [at[i], at[j]] = [at[j], at[i]];
      const o = objective(evalStack(at), at);
      if (o < cur) { cur = o; improved = true; }
      else [at[i], at[j]] = [at[j], at[i]];
    }
  }
  return at;
}

// ---- main ----
const minutes = parseFloat(process.argv[2] || "3");
if (!validate("aronson", "half") || !validate("aronson", "full") || !validate("mnemonica", "half")) {
  console.error("fast evaluator diverges from engine — aborting");
  process.exit(1);
}
const t0 = Date.now();
const r0 = evalStack(STACKS.aronson.map(c => ID[c]));
console.log(`eval speed: ${(Date.now() - t0)}ms per full evaluation`);
report("aronson  ", STACKS.aronson.map(c => ID[c]));
report("mnemonica", STACKS.mnemonica.map(c => ID[c]));

let bestAt = null, bestObj = Infinity;
const seedFile = process.argv[3];
if (seedFile) {
  // kick-restart around an existing solution: perturb, short anneal, polish
  bestAt = JSON.parse(fs.readFileSync(seedFile, "utf8")).map(c => ID[c]);
  bestAt = polish(bestAt);
  bestObj = objective(evalStack(bestAt), bestAt);
  const end = Date.now() + minutes * 60000;
  let round = 0;
  while (Date.now() < end) {
    round++;
    const at = [...bestAt];
    for (let k = 0; k < 4; k++) { // kick
      const i = (Math.random() * 52) | 0, j = (Math.random() * 52) | 0;
      [at[i], at[j]] = [at[j], at[i]];
    }
    const a = polish(anneal2(at, 0.35));
    const o = objective(evalStack(a), a);
    if (o < bestObj) { bestObj = o; bestAt = a; console.log(`round ${round}: improved ->`, evalStack(a).deadH, "dead"); }
  }
} else {
  for (const seed of [STACKS.aronson.map(c => ID[c]), STACKS.mnemonica.map(c => ID[c])]) {
    const a = anneal(seed, minutes / 2);
    const o = objective(evalStack(a), a);
    if (o < bestObj) { bestObj = o; bestAt = a; }
  }
  bestAt = polish(bestAt);
}
function anneal2(start, mins) {
  let at = [...start], cur = objective(evalStack(at), at);
  let bAt = [...at], bObj = cur;
  const end = Date.now() + mins * 60000;
  let T = 5e4;
  while (Date.now() < end) {
    const i = (Math.random() * 52) | 0; let j = (Math.random() * 52) | 0;
    if (i === j) j = (j + 1) % 52;
    [at[i], at[j]] = [at[j], at[i]];
    const o = objective(evalStack(at), at);
    if (o <= cur || Math.random() < Math.exp((cur - o) / T)) {
      cur = o;
      if (o < bObj) { bObj = o; bAt = [...at]; }
    } else [at[i], at[j]] = [at[j], at[i]];
    T = Math.max(1e3, T * 0.9998);
  }
  return bAt;
}
report("optimized", bestAt);
const stack = bestAt.map(i => CARDS[i]);
console.log("\nSTACK:", JSON.stringify(stack));
fs.writeFileSync("/tmp/oracle_stack.json", JSON.stringify(stack));
