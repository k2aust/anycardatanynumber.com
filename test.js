// Extracts the engine <script> block from index.html and sanity-checks the math.
// Run: node test.js
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const m = html.match(/\/\*ENGINE-START\*\/([\s\S]*?)\/\*ENGINE-END\*\//);
if (!m) { console.error("Engine block not found"); process.exit(1); }
const { ARONSON, STACKS, DEFAULT_SETTINGS, stackPos, numberWord, letterCount, cardPhrases,
        findOuts, findDoubleMiracle, cheatSheet, deadNumbers, scanCard, formatRanges } =
  eval("(function () {" + m[1] +
       "\n;return { ARONSON, STACKS, DEFAULT_SETTINGS, stackPos, numberWord, letterCount, cardPhrases, findOuts, findDoubleMiracle, cheatSheet, deadNumbers, scanCard, formatRanges };})()");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.error(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`); }
  else console.log(`ok   ${label}`);
}

// --- stack positions (full Aronson, JS on top) ---
check("JS at 1", stackPos("JS", "JS"), 1);
check("9D at 52", stackPos("9D", "JS"), 52);
check("QH at 26", stackPos("QH", "JS"), 26);
check("KH at 30", stackPos("KH", "JS"), 30);
check("7H at 25", stackPos("7H", "JS"), 25);

// --- cut deck rotation ---
check("cut: KC on top -> KC at 1", stackPos("KC", "KC"), 1);
check("cut: KC on top -> JS at 52", stackPos("JS", "KC"), 52);
check("cut: 9D on top -> JS at 2", stackPos("JS", "9D"), 2);

// --- number words ---
check("numberWord 1", numberWord(1), "ONE");
check("numberWord 15", numberWord(15), "FIFTEEN");
check("numberWord 27", numberWord(27), "TWENTY SEVEN");
check("numberWord 40", numberWord(40), "FORTY");
check("numberWord 52", numberWord(52), "FIFTY TWO");
check("letters TWENTY SEVEN = 11", letterCount(numberWord(27)), 11);
check("letters FIFTY TWO = 8", letterCount(numberWord(52)), 8);

// --- card phrases ---
const ph5c = cardPhrases("5C").map(p => [p.label, p.letters]);
check("5C phrases", ph5c, [["FIVE OF CLUBS", 11], ["THE FIVE OF CLUBS", 14], ["FIVE CLUBS", 9]]);
const ph10d = cardPhrases("10D").map(p => [p.label, p.letters]);
check("10D phrases", ph10d, [["TEN OF DIAMONDS", 13], ["THE TEN OF DIAMONDS", 16], ["TEN DIAMONDS", 11]]);

const S = DEFAULT_SETTINGS;

// --- direct miracle: 7H is at 25; S1 names 7H and 25 ---
let outs = findOuts({ c1: "7H", n1: 25, c2: "KC", n2: 40 }, S);
check("miracle is top result", [outs[0].method, outs[0].score, outs[0].tags], ["Deal to the number", 100, ["MIRACLE"]]);

// --- cross match: S1 card 7H, S2 number 25 ---
outs = findOuts({ c1: "7H", n1: 40, c2: "KC", n2: 25 }, S);
check("cross match scores 96", [outs[0].method, outs[0].score], ["Deal to the number", 100 + S.mod.cross]);

// --- face deal: 9D is 52 from top = 1 from face ---
outs = findOuts({ c1: "9D", n1: 1, c2: "KC", n2: 40 }, S);
const face = outs.find(o => o.method === "Deal to the number" && o.orient === "face");
check("face deal hit exists", !!face, true);
check("face deal score", face.score, 100 + S.mod.face);

// --- off by one (next card): 7H at 25, number 24 -> deal 24, next card ---
outs = findOuts({ c1: "7H", n1: 24, c2: "KC", n2: 40 }, S);
const offn = outs.find(o => o.method === "Deal to the number" && o.offset === 1 && o.orient === "top");
check("off-by-one next exists", !!offn, true);
check("off-by-one next score", offn.score, 100 + S.mod.offNext);

// --- off by one (one short): 7H at 25, number 26 ---
outs = findOuts({ c1: "7H", n1: 26, c2: "KC", n2: 40 }, S);
const offb = outs.find(o => o.method === "Deal to the number" && o.offset === -1 && o.orient === "top");
check("off-by-one short exists", !!offb, true);

// --- count-cut: KH at 30; numbers 10 and 20 sum to 30 ---
outs = findOuts({ c1: "KH", n1: 10, c2: "AS", n2: 20 }, S);
const cc = outs.find(o => o.method === "Count, cut, count again" && o.offset === 0 && o.orient === "top");
check("count-cut hit exists", !!cc, true);
check("count-cut score", cc.score, S.base.countCut);

// --- spell the number: pos 11 = 10S; "TWENTY SEVEN" = 11 letters ---
outs = findOuts({ c1: "10S", n1: 27, c2: "AS", n2: 40 }, S);
const sn = outs.find(o => o.method === "Spell the number" && o.offset === 0 && o.orient === "top");
check("spell-number hit exists", !!sn, true);
check("spell-number own-pair score", sn.score, S.base.spellNumber);

// --- deal then spell: QD at 21; "QUEEN OF DIAMONDS" = 15; deal 6 + 15 = 21 ---
outs = findOuts({ c1: "QD", n1: 6, c2: "AS", n2: 40 }, S);
const ds = outs.find(o => o.method === "Deal, then spell the card" && o.offset === 0 && o.orient === "top");
check("deal+spell hit exists", !!ds, true);
check("deal+spell score", ds.score, S.base.dealSpellCard);
check("deal+spell uses plain phrase", ds.title.includes('"QUEEN OF DIAMONDS"'), true);

// --- pure card spell: pos 11 = 10S; "TEN SPADES" = 9... no. "TEN OF SPADES" = 11 -> pos 11 hit ---
outs = findOuts({ c1: "10S", n1: 50, c2: "AS", n2: 40 }, S);
const sc = outs.find(o => o.method === "Spell the card" && o.offset === 0 && o.orient === "top");
check("pure spell hit exists", !!sc, true);
check("pure spell score", sc.score, S.base.spellCard);

// --- double miracle: 7H at 25 + KH at 30 ---
let dbl = findDoubleMiracle({ c1: "7H", n1: 25, c2: "KH", n2: 30 }, S);
check("double miracle detected", !!dbl, true);
dbl = findDoubleMiracle({ c1: "7H", n1: 30, c2: "KH", n2: 25 }, S);
check("crossed double miracle detected", !!dbl, true);
dbl = findDoubleMiracle({ c1: "7H", n1: 25, c2: "KH", n2: 31 }, S);
check("no false double miracle", dbl, null);

// --- settings respected: disable face dealing ---
const noFace = JSON.parse(JSON.stringify(S)); noFace.enabled.face = false;
outs = findOuts({ c1: "9D", n1: 1, c2: "KC", n2: 40 }, noFace);
// (instant reveal of the bottom card is not a deal — it survives the face toggle)
check("face disabled -> no face deals", outs.some(o => o.orient === "face" && o.method !== "Instant reveal"), false);

// --- rotation respected: cut so KC is on top; KC at 1 ---
const cutS = JSON.parse(JSON.stringify(S)); cutS.topCard = "KC";
outs = findOuts({ c1: "KC", n1: 1, c2: "AS", n2: 40 }, cutS);
check("cut deck miracle", [outs[0].score, outs[0].tags], [100, ["MIRACLE"]]);

// --- ranking: exact own-pair deal must outrank everything else in a busy scenario ---
outs = findOuts({ c1: "7H", n1: 25, c2: "10S", n2: 27 }, S);
check("busy scenario: miracle still #1", outs[0].tags.includes("MIRACLE"), true);
check("busy scenario: multiple outs found", outs.length >= 2, true);

// --- single-spectator mode: only c1 + n1 ---
outs = findOuts({ c1: "7H", n1: 25 }, S);
check("single: miracle found", [outs[0].score, outs[0].tags], [100, ["MIRACLE"]]);
check("single: no count-cut without second number", outs.some(o => o.method === "Count, cut, count again"), false);
outs = findOuts({ c1: "7H", n1: 24 }, S);
check("single: off-by-one works", outs.some(o => o.method === "Deal to the number" && o.offset === 1), true);
check("single: double miracle is null", findDoubleMiracle({ c1: "7H", n1: 25 }, S), null);
let sheet = cheatSheet({ c1: "7H", n1: 25 }, S);
check("single: cheat sheet has 2 rows, no sum", [sheet.length, sheet.some(r => r.includes("summed"))], [2, false]);

// --- partial: one card, two numbers -> count-cut still available ---
outs = findOuts({ c1: "KH", n1: 10, n2: 20 }, S);
check("1 card + 2 numbers: count-cut hit", outs.some(o => o.method === "Count, cut, count again" && o.offset === 0 && o.orient === "top"), true);

// --- reversed dealt pile: deal a, count b into pile -> hit at a - b + 1 ---
// 7H at 25: deal 30, count 6 into pile -> 30 - 6 + 1 = 25
outs = findOuts({ c1: "7H", n1: 30, c2: "AS", n2: 6 }, S);
let back = outs.find(o => o.method === "Deal, then count into the dealt pile" && o.offset === 0 && o.orient === "top");
check("count-into-pile hit exists", !!back, true);
check("count-into-pile score", back.score, S.base.dealCountBack);
// same numbers in swapped slots must still find it (engine tries both orders)
outs = findOuts({ c1: "7H", n1: 6, c2: "AS", n2: 30 }, S);
check("count-into-pile order-independent", outs.some(o => o.method === "Deal, then count into the dealt pile" && o.offset === 0), true);
// second count larger than the pile is impossible: 7H at 25 via 6 - 30 makes no sense
outs = findOuts({ c1: "5C", n1: 6, c2: "AS", n2: 30 }, S); // 5C at 3; no a-b+1 = 3 with these
check("count-into-pile respects pile size", outs.some(o => o.method === "Deal, then count into the dealt pile" && o.title.includes("Deal 6 cards")), false);

// --- deal, then spell the card into the pile: deal 37, spell SEVEN OF HEARTS (13) -> 37 - 13 + 1 = 25 ---
outs = findOuts({ c1: "7H", n1: 37 }, S);
back = outs.find(o => o.method === "Deal, then spell the card into the dealt pile" && o.offset === 0 && o.orient === "top");
check("spell-card-into-pile hit exists", !!back, true);
check("spell-card-into-pile score (own pair)", back.score, S.base.dealSpellBack);
check("spell-card-into-pile phrase", back.title.includes('"SEVEN OF HEARTS" (13 letters)'), true);

// --- deal, then spell the SAME number into the pile: deal 30, spell THIRTY (6) -> 30 - 6 + 1 = 25 ---
outs = findOuts({ c1: "7H", n1: 30 }, S);
back = outs.find(o => o.method === "Deal, then spell a number into the dealt pile" && o.offset === 0 && o.orient === "top");
check("spell-same-number-into-pile hit exists", !!back, true);
check("spell-same-number-into-pile score", back.score, S.base.dealSpellNumBack);
check("spell-same-number text", back.title.includes("that same number"), true);

// --- face-up variant: KC at 2 from top = 51 from face; deal 52 face up, count 2 -> 52 - 2 + 1 = 51 ---
outs = findOuts({ c1: "KC", n1: 52, c2: "AS", n2: 2 }, S);
back = outs.find(o => o.method === "Deal, then count into the dealt pile" && o.orient === "face" && o.offset === 0);
check("count-into-pile face variant", !!back, true);
check("count-into-pile face score", back.score, S.base.dealCountBack + S.mod.face);

// --- disable flags kill the family ---
const noBack = JSON.parse(JSON.stringify(S));
noBack.enabled.dealCountBack = noBack.enabled.dealSpellBack = noBack.enabled.dealSpellNumBack = noBack.enabled.indicatorBack = false;
outs = findOuts({ c1: "7H", n1: 30, c2: "AS", n2: 6 }, noBack);
check("into-pile methods disabled", outs.some(o => o.method.includes("dealt pile")), false);

// --- cut a named card to top/bottom, then any method ---
// 7H at 25 (idx 24), KH at 30 (idx 29). Cut 7H to TOP -> KH lands at 6.
outs = findOuts({ c1: "7H", n1: 50, c2: "KH", n2: 6 }, S);
check("cut-to-top: top result is cut + deal", [outs[0].method, outs[0].score],
  ["Cut + Deal to the number", S.base.deal + S.mod.cutCard]);
check("cut-to-top: title names the cut", outs[0].title.includes("Casually cut the 7♥ (S1's card) to the TOP"), true);
check("cut-to-top: inner deal correct", outs[0].title.includes("Card #6 is the K♥"), true);
// Cut 7H to BOTTOM -> QH becomes top -> KH lands at 5.
outs = findOuts({ c1: "7H", n1: 50, c2: "KH", n2: 5 }, S);
check("cut-to-bottom: top result is cut + deal", [outs[0].method, outs[0].score],
  ["Cut + Deal to the number", S.base.deal + S.mod.cutCard]);
check("cut-to-bottom: title names the cut", outs[0].title.includes("Casually cut the 7♥ (S1's card) to the BOTTOM"), true);
// never two cuts stacked
check("no double cuts", outs.every(o => !o.method.startsWith("Cut + Cut")), true);
// no-op cut skipped when the card is already on top
const cutS2 = JSON.parse(JSON.stringify(S)); cutS2.topCard = "7H";
outs = findOuts({ c1: "7H", n1: 50, c2: "KH", n2: 6 }, cutS2);
check("no-op cut suppressed", outs.every(o => !(o.title.includes("Casually cut the 7♥") && o.title.includes("to the TOP"))), true);
// disable flag
const noCutS = JSON.parse(JSON.stringify(S)); noCutS.enabled.cutCard = false;
outs = findOuts({ c1: "7H", n1: 50, c2: "KH", n2: 6 }, noCutS);
check("cut disabled -> no cut methods", outs.some(o => o.method.startsWith("Cut + ")), false);

// --- facing conventions: stack-preserving deals vs reversing deals ---
// plain deal off the top -> FACE UP
outs = findOuts({ c1: "7H", n1: 25 }, S);
check("top deal says FACE UP", outs[0].steps[0] === "Hold the deck FACE DOWN" && outs[0].steps[1].includes("face up to the table"), true);
// plain deal off the face -> FACE DOWN
outs = findOuts({ c1: "9D", n1: 1, c2: "KC", n2: 40 }, S);
let f = outs.find(o => o.method === "Deal to the number" && o.orient === "face");
check("face deal says FACE DOWN", f.steps[0] === "Hold the deck FACE UP" && f.steps[1].includes("face down to the table"), true);
// into-pile off the top -> reversing deal is FACE DOWN
outs = findOuts({ c1: "7H", n1: 30, c2: "AS", n2: 6 }, S);
f = outs.find(o => o.method === "Deal, then count into the dealt pile" && o.orient === "top");
check("into-pile top deal says FACE DOWN", f.title.includes("FACE DOWN into a pile"), true);
check("into-pile top mentions reversal", f.title.includes("reverses their order"), true);
// into-pile off the face -> reversing deal keeps cards FACE UP
outs = findOuts({ c1: "KC", n1: 52, c2: "AS", n2: 2 }, S);
f = outs.find(o => o.method === "Deal, then count into the dealt pile" && o.orient === "face");
check("into-pile face deal says FACE UP", f.title.includes("FACE UP into a pile"), true);
// count-cut restores the packet
outs = findOuts({ c1: "KH", n1: 10, c2: "AS", n2: 20 }, S);
f = outs.find(o => o.method === "Count, cut, count again" && o.orient === "top");
check("count-cut flips packet back", f.title.includes("Flip the counted cards face down and cut them to the bottom"), true);

// --- card only, no number yet: pure spell hits ---
// 10S at 11; "TEN OF SPADES" = 11 letters -> exact spell, no number needed
outs = findOuts({ c1: "10S" }, S);
check("card-only: spell hit found", [outs[0].method, outs[0].score], ["Spell the card", S.base.spellCard]);
check("card-only: spells exactly", outs[0].title.includes('"TEN OF SPADES" (11 letters)'), true);
// 2H at 4: no spelling (9-16 letters) can reach it, even after a cut
outs = findOuts({ c1: "2H" }, S);
check("card-only: no false hits", outs.length, 0);

// --- instant reveal: named card already on top or on the face ---
outs = findOuts({ c1: "JS", n1: 30 }, S);
check("instant reveal top", [outs[0].method, outs[0].score], ["Instant reveal", S.base.directReveal]);
check("instant reveal top text", outs[0].steps[0].includes("already on TOP"), true);
outs = findOuts({ c1: "9D", n1: 30 }, S);
let ir = outs.find(o => o.method === "Instant reveal");
check("instant reveal bottom", !!ir, true);
check("instant reveal bottom: no face penalty", ir.score, S.base.directReveal);

// --- double lift handling for one-short deals ---
outs = findOuts({ c1: "7H", n1: 26, c2: "KC", n2: 40 }, S);
const dl = outs.find(o => o.method === "Deal to the number" && o.offset === -1);
check("double lift steps", dl.steps.some(s => s.includes("into YOUR hands")) &&
  dl.steps.some(s => s.includes("Double lift")), true);
check("double lift score", dl.score, S.base.deal + S.mod.offBefore);

// --- cut only ever finds the OTHER card ---
outs = findOuts({ c1: "7H", n1: 50, c2: "KH", n2: 6 }, S);
check("cut never reveals the cut card", outs.filter(o => o.method.startsWith("Cut + "))
  .every(o => (o.steps[0].includes("7♥") ? o.card !== "7H" : o.card !== "KH")), true);
// adjacent pair: cutting 7H to the BOTTOM puts QH (next in stack) on top -> instant reveal
outs = findOuts({ c1: "7H", n1: 50, c2: "QH", n2: 50 }, S);
check("cut + instant reveal of the other card", outs.some(o =>
  o.method === "Cut + Instant reveal" && o.card === "QH" && o.steps[0].includes("BOTTOM")), true);

// --- jokers: two jokers shift counts by 2 on their side of the deck ---
// 7H at 25 -> jokers on TOP make it deal as 27
outs = findOuts({ c1: "7H", n1: 27, c2: "AS", n2: 50 }, S);
let jk = outs.find(o => o.method === "Jokers + Deal to the number");
check("jokers top shift", !!jk, true);
check("jokers top score", jk.score, S.base.deal + S.mod.jokers);
check("jokers step text", jk.steps[0].includes("Add BOTH Jokers to the TOP"), true);
// 7H face position 28 -> jokers on the FACE make it 30 from the face
outs = findOuts({ c1: "7H", n1: 30, c2: "AS", n2: 50 }, S);
jk = outs.find(o => o.method === "Jokers + Deal to the number" && o.orient === "face" && o.card === "7H");
check("jokers face shift", !!jk, true);
check("jokers face score", jk.score, S.base.deal + S.mod.jokers + S.mod.face);
// jokers disabled
const noJk = JSON.parse(JSON.stringify(S)); noJk.enabled.jokers = false;
outs = findOuts({ c1: "7H", n1: 27, c2: "AS", n2: 50 }, noJk);
check("jokers disabled", outs.some(o => o.method.startsWith("Jokers + ")), false);

// --- every result is step-structured ---
outs = findOuts({ c1: "7H", n1: 25, c2: "10S", n2: 27 }, S);
check("all results have steps", outs.every(o => Array.isArray(o.steps) && o.steps.length >= 1), true);

// --- half-deck mode: every out begins with REPLACE or CUT ---
const halfS = JSON.parse(JSON.stringify(S)); halfS.mode = "half";
outs = findOuts({ c1: "7H", n1: 25 }, halfS);
check("half: REPLACE miracle wins", [outs[0].score, outs[0].tags], [100, ["MIRACLE"]]);
check("half: starts with REPLACE", outs[0].steps[0].includes("REPLACE"), true);
// KH at 30 -> after CUT (bottom half on top) it sits at position 4
outs = findOuts({ c1: "KH", n1: 4 }, halfS);
check("half: CUT branch deal", [outs[0].score, outs[0].steps[0].includes("CUT"),
  outs[0].steps.some(s => s.includes("Deal 4 cards"))], [100, true, true]);
// 5D at 27 -> after CUT it is the top card: instant reveal, no penalty
outs = findOuts({ c1: "5D", n1: 40 }, halfS);
check("half: instant reveal after CUT", [outs[0].method, outs[0].score, outs[0].steps[0].includes("CUT")],
  ["Instant reveal", S.base.directReveal, true]);
check("half: every out begins with REPLACE or CUT", outs.every(o =>
  o.steps[0].startsWith("REPLACE") || o.steps[0].startsWith("CUT")), true);
// count-cut after REPLACE: 5S at 20, 8 + 12 = 20
outs = findOuts({ c1: "5S", n1: 8, n2: 12 }, halfS);
check("half: count-cut present", outs.some(o => o.method === "Count, cut, count again"), true);
// full mode is untouched by the new code paths
outs = findOuts({ c1: "7H", n1: 25 }, S);
check("full mode unaffected", [outs[0].score, outs[0].tags, outs[0].steps[0]],
  [100, ["MIRACLE"], "Hold the deck FACE DOWN"]);

// --- indicator cards: arrive at a 2-10, deal that many more ---
// position 5 = 9S (value 9) -> 5 + 9 = 14 = KD
outs = findOuts({ c1: "KD", n1: 5 }, S);
check("indicator: direct hit", [outs[0].method, outs[0].score], ["Deal to an indicator card", S.base.indicator]);
check("indicator: steps", outs[0].steps.some(s => s.includes("9♠") && s.includes("INDICATOR")) &&
  outs[0].steps.some(s => s.includes("deal 9 more cards")), true);
// off-by-one arrival: number 4, NEXT card is the 9S indicator
outs = findOuts({ c1: "KD", n1: 4 }, S);
let indo = outs.find(o => o.method === "Deal to an indicator card" && o.offset === 1);
check("indicator: off-by-one arrival", !!indo, true);
check("indicator: off-by-one score", indo.score, S.base.indicator + S.mod.offNext);
// court cards are not indicators: position 1 = JS
outs = findOuts({ c1: "5C", n1: 1 }, S);
check("indicator: no court-card indicators", outs.some(o => o.method === "Deal to an indicator card"), false);
// face orientation: face #1 = 9D (value 9) -> face #10 = KS
outs = findOuts({ c1: "KS", n1: 1 }, S);
indo = outs.find(o => o.method === "Deal to an indicator card" && o.orient === "face");
check("indicator: face variant", !!indo, true);
check("indicator: face score", indo.score, S.base.indicator + S.mod.face);
// half mode: indicator works after REPLACE (9S at 5 bridges to KD at 14)
outs = findOuts({ c1: "KD", n1: 5 }, halfS);
check("indicator: half mode", [outs[0].method, outs[0].score, outs[0].steps[0].includes("REPLACE")],
  ["Deal to an indicator card", S.base.indicator, true]);

// --- one short is impossible in face orientation (faces are seen as dealt) ---
// QS at 48 = face position 5; number 6 would need a face-orientation double lift
outs = findOuts({ c1: "QS", n1: 6 }, S);
check("no face-orientation double lift", outs.some(o => o.orient === "face" && o.offset === -1), false);

// --- reversed indicator: deal 27, the 27th card (5D, value 5) counts as 1 -> 8S at 23 ---
outs = findOuts({ c1: "8S", n1: 27 }, S);
check("indicator-back: 8S + 27 hit", [outs[0].method, outs[0].score],
  ["Deal, then indicator into the dealt pile", S.base.indicatorBack]);
check("indicator-back: steps", outs[0].steps.some(s => s.includes("5\u2666") && s.includes("INDICATOR")) &&
  outs[0].steps.some(s => s.includes("RETURN the 5\u2666 face down to the pile")), true);
const noIndBack = JSON.parse(JSON.stringify(S)); noIndBack.enabled.indicatorBack = false;
check("indicator-back: toggle", findOuts({ c1: "8S", n1: 27 }, noIndBack)
  .some(o => o.method.includes("indicator into")), false);

// --- forward RETURN convention: 9S at 5 returned -> 5 + 9 - 1 = 13 = 2D ---
outs = findOuts({ c1: "2D", n1: 5 }, S);
let fwdRet = outs.find(o => o.method === "Deal to an indicator card" &&
  o.steps.some(st => st.includes("RETURN the 9\u2660 to the top of the deck")));
check("indicator: RETURN convention", [!!fwdRet, fwdRet && fwdRet.score], [true, S.base.indicator]);

// --- reversed REMOVE convention: deal 27, remove the 5D -> 27 - 5 = 22 = AH ---
outs = findOuts({ c1: "AH", n1: 27 }, S);
let backRem = outs.find(o => o.method === "Deal, then indicator into the dealt pile" &&
  o.steps.some(st => st.includes("REMOVE the 5\u2666")));
check("indicator-back: REMOVE convention", [!!backRem, backRem && backRem.score], [true, S.base.indicatorBack]);

// --- reversed + double lift: deal 28, 7C indicator -> 28 - 7 + 2 = 23 = 8S ---
// (digit sum may now outrank it as outs[0], so search for the specific method)
outs = findOuts({ c1: "8S", n1: 28 }, S);
const dlBack = outs.find(o => o.method === "Deal, then indicator into the dealt pile" && o.offset === -1);
check("indicator-back: double lift hit", [!!dlBack, dlBack && dlBack.score],
  [true, S.base.indicatorBack + S.mod.offBefore]);
check("indicator-back: double lift steps", dlBack.steps.some(st => st.includes("7\u2663")) &&
  dlBack.steps.some(st => st.includes("Double lift")) &&
  dlBack.steps.some(st => st.includes("into YOUR hands")), true);
// reversed indicator never runs in face orientation
check("indicator-back: top only", outs.every(o =>
  !(o.method.includes("indicator into") && o.orient === "face")), true);

// --- dead numbers: 27 and 28 are no longer dead for the 8S ---
const dead8s = deadNumbers("8S", S);
check("deadNumbers: 27 now hits for 8S", dead8s.includes(27), false);
check("deadNumbers: 28 now hits for 8S", dead8s.includes(28), false);
check("deadNumbers: returns an array", Array.isArray(dead8s), true);

// --- Mnemonica stack ---
check("Mnemonica has 52 unique cards", new Set(STACKS.mnemonica).size, 52);
check("Mnemonica top is 4C", STACKS.mnemonica[0], "4C");
check("Mnemonica bottom is 9D", STACKS.mnemonica[51], "9D");
const mn = JSON.parse(JSON.stringify(S)); mn.stack = "mnemonica"; mn.topCard = "4C";
// AS is at Mnemonica position 7 -> miracle when named with 7
check("Mnemonica position lookup", stackPos("AS", "4C", STACKS.mnemonica), 7);
outs = findOuts({ c1: "AS", n1: 7 }, mn);
check("Mnemonica miracle", [outs[0].method, outs[0].score, outs[0].tags], ["Deal to the number", 100, ["MIRACLE"]]);
// same card+number under Aronson is NOT a miracle (AS is at Aronson position 6)
outs = findOuts({ c1: "AS", n1: 7 }, S);
check("Aronson differs from Mnemonica", outs.some(o => o.tags.includes("MIRACLE")), false);
// cut handling respects the Mnemonica order: 2H follows 4C, cut 2H to bottom -> 7D on top
outs = findOuts({ c1: "2H", n1: 50, c2: "7D", n2: 1 }, mn);
check("Mnemonica cut math", outs.some(o => o.method === "Cut + Instant reveal" && o.card === "7D"), true);
// coverage is non-trivial under Mnemonica too
check("Mnemonica has outs", findOuts({ c1: "QH", n1: 11 }, mn).length > 0, true);

// --- spell card first, then count: QD at 21, "QUEEN OF DIAMONDS"=15, count 6 -> 15+6=21 ---
outs = findOuts({ c1: "QD", n1: 6 }, S);
let scnt = outs.find(o => o.method === "Spell the card, then count to the number" && o.offset === 0);
check("spell-then-count hit", [!!scnt, scnt && scnt.score], [true, S.base.spellCount]);
check("spell-then-count step order", scnt.steps[1].includes('Spell "QUEEN OF DIAMONDS"') &&
  scnt.steps.some(st => st.includes("count 6 more")), true);
const noSC = JSON.parse(JSON.stringify(S)); noSC.enabled.spellCount = false;
check("spell-then-count toggle", findOuts({ c1: "QD", n1: 6 }, noSC)
  .some(o => o.method.startsWith("Spell the card, then count")), false);

// --- spectator-cut mode ---
const cutMode = JSON.parse(JSON.stringify(S)); cutMode.mode = "cut"; cutMode.topCard = "JS";
outs = findOuts({ c1: "7H", n1: 25 }, cutMode);
check("cut mode: opens with cut step", outs[0].steps[0].includes("Spectator cuts"), true);
check("cut mode: top glimpse keeps rotation", outs[0].tags.includes("MIRACLE"), true);
// glimpse the BOTTOM: bottom card KC means top is 5C (next in stack) -> rotation shifts by 1
const cutBot = JSON.parse(JSON.stringify(S)); cutBot.mode = "cut"; cutBot.noteEnd = "bottom"; cutBot.topCard = "JS";
outs = findOuts({ c1: "KC", n1: 1 }, cutBot);
check("cut mode bottom: glimpsed JS on bottom -> KC on top", outs[0].steps[0].includes("on the BOTTOM") &&
  outs[0].tags.includes("MIRACLE"), true);

// --- formatRanges ---
check("formatRanges runs", formatRanges([23,24,25,31,51,52]), "23–25, 31, 51–52");
check("formatRanges single", formatRanges([7]), "7");
check("formatRanges empty", formatRanges([]), "");
check("formatRanges unsorted", formatRanges([3,1,2,9]), "1–3, 9");

// --- scanCard: best numbers + dead, one sweep ---
const sc7h = scanCard("7H", S);
check("scanCard: 7H best includes its position 25 (miracle)", sc7h.best.includes(25) && sc7h.max === 100, true);
check("scanCard: dead matches deadNumbers", JSON.stringify(sc7h.dead), JSON.stringify(deadNumbers("7H", S)));
check("scanCard: best are all strong", sc7h.best.every(n => sc7h.score[n] >= 90), true);

// --- Oracle (optimized) stack ---
check("Oracle has 52 unique cards", new Set(STACKS.oracle).size, 52);
const orc = JSON.parse(JSON.stringify(S)); orc.stack = "oracle"; orc.topCard = STACKS.oracle[0]; orc.mode = "half";
// with digit sum on (default) Oracle has ZERO dead pairs in split mode
let orcDead = 0; for (const c of STACKS.oracle) orcDead += deadNumbers(c, orc).length;
check("Oracle: 0 dead pairs in split mode (digit sum on)", orcDead, 0);
// without digit sum it falls back to its 4 number-52 dead pairs
const orcNoDS = JSON.parse(JSON.stringify(orc)); orcNoDS.enabled.digitSum = false;
let orcDead2 = 0; const orcPairs = [];
for (const c of STACKS.oracle) for (const n of deadNumbers(c, orcNoDS)) { orcDead2++; orcPairs.push(n); }
check("Oracle: 4 dead pairs without digit sum, all at 52", [orcDead2, orcPairs.every(n => n === 52)], [4, true]);

// --- digit sum: 47 -> 4+7 -> 11, runs the count methods at 11 ---
// pick a card where the literal number is dead but the digit sum lands it
const dsTest = JSON.parse(JSON.stringify(S)); dsTest.mode = "full";
let dsHit = null;
for (const c of STACKS.aronson) {
  const r = findOuts({ c1: c, n1: 47 }, dsTest);
  const d = r.find(o => o.method.startsWith("Digit sum + "));
  if (d) { dsHit = { c, d }; break; }
}
check("digit sum produces outs", !!dsHit, true);
check("digit sum framing step", dsHit.d.steps.some(st => /Add the digits of 47 \(4 \+ 7 = 11\)/.test(st)), true);
check("digit sum only wraps number-using methods",
  /Deal to the number|spell the card|indicator/.test(dsHit.d.method), true);
// toggle off removes them
const noDS = JSON.parse(JSON.stringify(dsTest)); noDS.enabled.digitSum = false;
check("digit sum toggle", findOuts({ c1: dsHit.c, n1: 47 }, noDS).some(o => o.method.includes("Digit sum")), false);
// single-digit numbers are never digit-summed (no-op)
check("no digit sum for single-digit numbers",
  findOuts({ c1: "7H", n1: 8 }, dsTest).some(o => o.method.includes("Digit sum")), false);

// one-short on a spell is unusable — must never be generated
// a one-short *spell* (the spell itself landing short) is unusable; a one-short
// COUNT after a spell (spellCount) is fine — it ends on a double lift.
const spellLandsShort = o => o.offset === -1 && /spell/i.test(o.method) &&
  !/count to the number/.test(o.method);
check("8S + 8: no one-short spell out", findOuts({ c1: "8S", n1: 8 }, S).some(spellLandsShort), false);

// --- coverage sweep: how often does at least one out exist? ---
let total = 0, hits = 0, miracleish = 0, badSpellOffsets = 0;
for (let trial = 0; trial < 20000; trial++) {
  const c1 = ARONSON[Math.floor(Math.random() * 52)];
  let c2; do { c2 = ARONSON[Math.floor(Math.random() * 52)]; } while (c2 === c1);
  const n1 = 1 + Math.floor(Math.random() * 52), n2 = 1 + Math.floor(Math.random() * 52);
  const r = findOuts({ c1, n1, c2, n2 }, S);
  total++;
  if (r.length) hits++;
  if (r.length && r[0].score >= 90) miracleish++;
  badSpellOffsets += r.filter(spellLandsShort).length;
  badSpellOffsets += r.filter(o => o.offset === -1 && o.orient === "face").length;
  badSpellOffsets += r.filter(o => o.method.includes("indicator into") && o.orient === "face").length;
}
check("sweep: no one-short spells or face-orientation double lifts anywhere", badSpellOffsets, 0);
console.log(`\ncoverage: ${(100 * hits / total).toFixed(1)}% of random inputs have at least one out; ` +
  `${(100 * miracleish / total).toFixed(1)}% have a 90+ scoring out`);

console.log(failures ? `\n${failures} FAILURES` : "\nall tests passed");
process.exit(failures ? 1 : 0);
