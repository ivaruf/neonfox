# Worklist

Things worth doing that are not being done right now. Not a backlog of
everything imaginable — the game already has a README for what it is and an
ARCHITECTURE for how it works. This is the short list of known problems, each
with enough of the reasoning that picking one up does not mean rediscovering
why it is on the list.

Cross one off by fixing it, not by deciding it no longer matters. If it stops
mattering, say so in the entry and delete it.

---

## The neon palette is not distinct enough

**Every rider colour has to be tellable from every other one at a glance, and
two pairs currently are not.** `js/config.js` `PALETTE`:

| slot | name  | hex       |        |
| ---- | ----- | --------- | ------ |
| 0    | Bolt  | `#3aa0ff` | blue   |
| 1    | Mochi | `#ff5fb4` | pink   |
| 2    | Kiwi  | `#5cf07a` | green  |
| 3    | Tango | `#ffa03c` | orange |
| 4    | Plum  | `#b07cff` | violet |
| 5    | Zippy | `#ffe14a` | yellow |

The reported trouble is **the yellow and the violet hues especially** — Tango
and Zippy read as one warm smear at speed, and Mochi and Plum as one cool one.

Why it is worse here than the hex codes suggest: a rider's colour is worn by
four things at once (the fox's fur, its orb, its trail ribbon and its
scoreboard chip), and three of those go through `scene.js`'s GlowLayer, which
blooms bright colours toward white. Two hues that are merely close on a swatch
become the same pale glow on a trail three seconds old. The arena is also
mostly navy with cyan rim light, so anything in the blue half of the wheel is
competing with the room as well as with the other riders.

Worth knowing before changing anything:

- **Slot order is the roster order.** `main.js` `buildSpecs()` hands slot 0 and
  1 to the humans because the keyboard hints are written against them, so a
  two-player game is always Bolt vs Mochi. Whatever the new palette is, the
  first two entries have to be the most distinct pair in it.
- **The colours are not only decoration.** `marker.js` tints the arrow and the
  ring, `trails.js` the ribbons, `rider.js` five materials on the fox. All of
  them read `PALETTE[i].hex`, so this is one array to change and nothing else.
- **Test it as trails, not as swatches.** A 0.6-unit ribbon under bloom is the
  hard case; six squares on a white background will pass anything.
- Colour-blind players are not currently considered at all. The markers help a
  local player find themselves, but nothing distinguishes two rivals.

## Symbol codes can repeat, and the set is tonally random

A room code is three symbols drawn with repeats allowed, so `tree · hat · hat`
happens — hard to read aloud, easy to mistap on the keypad. And the set in
`js/net/codes.js` is fox, duck, bee, car, rocket, pizza, tree, star, moon,
key, hat: a pizza and a top hat in a neon fox game.

Two separate questions: whether a code may repeat a symbol (probably not), and
whether the symbols should come from this game's own world rather than from
the emoji drawer.
