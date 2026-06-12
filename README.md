# Stack Oracle — Any Card at Any Number

A single-file web app that finds the cleanest way to reveal a named card at a
named number in a memorized-deck ACAAN. The spectator names a card and a number;
the app searches the whole out-space and returns ranked, step-by-step handlings.

Live: **[anycardatanynumber.com](https://anycardatanynumber.com)**

## What it does

- Works with the **Aronson**, **Mnemonica**, or a purpose-built **Oracle** stack
  (computer-optimized for this trick — 0 dead card/number pairs in split mode).
- Searches deals, spells (multiple phrasings), indicator cards (both
  conventions), reversed-pile counts, count-cut-count, jokers, cuts, the
  digit-sum transformation, and more — then ranks them by how clean they are.
- Deck modes: full deck, pre-split halves (reassemble either way), or a
  spectator cut you glimpse.
- After the card is named it shows the strongest numbers, any no-number out, and
  the dead-zone ranges to steer around.

Everything runs client-side — open `index.html` in any phone browser, no server,
works offline.

## Files

- `index.html` — the entire app (engine + UI in one file). The engine lives
  between the `/*ENGINE-START*/` and `/*ENGINE-END*/` markers.
- `test.js` — engine test suite. Run `node test.js` (extracts and exercises the
  engine block; ~150 assertions, plus a random-input coverage sweep).
- `optimize.js` — simulated-annealing stack optimizer that produced the Oracle
  stack. Run `node optimize.js [minutes]`.
