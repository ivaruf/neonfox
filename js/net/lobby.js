/*
 * lobby.js — the screen where a game is opened or found.
 *
 * TWO STEPS, NOT ONE PANEL. It used to be a single screen with a Host/Join
 * segment at the top and both halves of the flow stacked under it, which made
 * it the tallest thing in the game and buried the one piece of information a
 * friend actually needs — the three pictures — two thirds of the way down,
 * under a mode switch, a name field and a paragraph about keyboards. So:
 *
 *   1. CHOOSE. Who you are, and Host or Join. Two buttons, nothing else.
 *   2. LOBBY. Where a host and a guest end up in exactly the same place: the
 *      code, big, and the roster of everyone in the room. Joining takes a
 *      detour through the keypad to get here, and getting the code right is
 *      the only difference between the two arrivals.
 *
 * That third view, the keypad, is a step ON THE WAY to the lobby rather than
 * a destination — which is also the bug it fixes. The roster used to live
 * inside the host's view, so a guest who had successfully joined watched a
 * status line and never saw who else was in the room. One lobby, shared, and
 * the only thing that differs is that a guest has no Blaze! (starting is the
 * host's, and a button that does nothing is worse than no button).
 *
 * Menus belong to the game (hub CLAUDE.md §2), so this is built out of the
 * paddock's own parts: the same .panel over the same live attract arena, the
 * same .primary and .ghost buttons, the same .chip rows the scoreboard uses.
 * The three controls the paddock has no precedent for — a name field, a die
 * and a keypad of pictures — get the rules at the top of this file, written
 * against the palette's own custom properties so they cannot drift from it.
 * Nothing here is a bare OS control.
 *
 * It creates its own DOM rather than reading ids out of index.html, because
 * index.html belongs to another lane. The one thing it cannot make for itself
 * is the way in: a "Multiplayer" button in the paddock. If index.html has a
 * #together button this file adopts it; if it does not, it inserts one after
 * #start, so the feature works either way and the markup can catch up later.
 *
 * Its words are plain (hub §2, "Menus speak plainly"): the screen is called
 * Multiplayer, the button that starts a match says Play like the one next
 * door, and every back button says what it does. It used to say Together and
 * Blaze!, which were the game talking where a player was looking for a handle.
 *
 * TWO LANGUAGES, LIVE. Static labels carry data-i18n and js/i18n.js repaints
 * them; everything this file writes from state goes through write(), which
 * keeps the words as a function and says them again on `arcade:lang`. What
 * the host and the net code report arrives as KEYS and arguments (a refusal
 * reason, a peer's name) and is rendered here, on this device, in this
 * device's language — never a sentence off the wire.
 */

import { SYMBOLS, CODE_LENGTH, codeIcons, parseCode } from "./codes.js";
import { MAX_NAME, rollName } from "./protocol.js";
import { PALETTE } from "../config.js";
import { t, paintStatic } from "../i18n.js";

const NAME_KEY = "neonfox.netname.v1";

const CSS = `
#lobby .code-row { display: flex; gap: 10px; justify-content: center; margin: 14px 0 6px; }
#lobby .code-slot {
  width: 56px; height: 56px; line-height: 56px; font-size: 30px; text-align: center;
  border-radius: 14px; border: 1px solid var(--line); background: rgba(70,230,255,0.07);
}
#lobby .code-slot.empty { color: var(--ink-dim); font-size: 20px; }
/* The hero version, on the lobby step, where these three pictures ARE the
   screen: what a host reads out and what a guest checks they got right. */
#lobby .code-row.hero { gap: 12px; margin: 6px 0 8px; }
#lobby .code-row.hero .code-slot {
  width: 88px; height: 88px; line-height: 88px; font-size: 46px; border-radius: 22px;
  border-color: rgba(70,230,255,0.45); background: rgba(70,230,255,0.10);
  box-shadow: 0 0 26px rgba(70,230,255,0.18);
}
#lobby .pad { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin: 10px 0; }
#lobby .pad button {
  font-size: 26px; padding: 8px 0; border-radius: 12px;
  border: 1px solid var(--line); background: rgba(130,170,255,0.08); color: var(--ink);
}
#lobby .pad button:hover { background: rgba(70,230,255,0.16); }
#lobby .nameField {
  flex: 1; font: inherit; color: var(--ink); padding: 9px 12px; border-radius: 12px;
  border: 1px solid var(--line); background: rgba(10,16,48,0.6); min-width: 0;
}
#lobby .nameField:focus-visible { outline: 2px solid var(--rim); outline-offset: 2px; }
/* The die, fishtank's control and fishtank's shape: square with the field,
   sitting right against it so the two read as one thing. */
#lobby .reroll {
  flex: 0 0 auto; width: 46px; min-height: 42px; padding: 0;
  display: grid; place-items: center;
  border-radius: 12px; border: 1px solid var(--line);
  background: rgba(130,170,255,0.08); color: var(--ink-dim);
}
#lobby .reroll:hover { color: var(--ink); background: rgba(70,230,255,0.16); }
#lobby .reroll svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; }
/* Every other icon in this game is a stroke; a die's spots are the exception,
   because three rings at 20px are three smudges. */
#lobby .reroll .pip { fill: currentColor; stroke: none; }
/* The two doors of this screen, stacked and the same size as each other —
   the paddock's own rule for a pair of equal choices (hub §2). */
#lobby .choices { display: grid; gap: 10px; margin: 18px 0 4px; }
#lobby .choices .primary { width: 100%; margin: 0; }
#lobby .roster { list-style: none; margin: 12px 0 4px; padding: 0; display: grid; gap: 6px; }
#lobby .note { color: var(--ink-dim); font-size: 12px; margin: 6px 0 0; line-height: 1.5; }
#lobby .live { color: var(--rim); }
#lobby .warn { color: #ffa03c; }

/* ---------------- Landscape phones: every step sideways ------------------
   The same cut maxgear and the paddock use (hub CLAUDE.md §2), and the same
   trick: a grid laid over the existing markup BY AREA, so portrait is
   untouched and nothing moves in the DOM. This screen needed it most — the
   room step stacked an 88px code, its words, a status line, six roster chips
   and a Blaze! into one column, which is about 440px of content on a phone
   that has 340. Sideways there is width instead, so the code sits BESIDE the
   roster and the column disappears.

   The h1 goes in all three steps: it costs 44px and the kicker above it
   already says which step this is. */
@media (orientation: landscape) and (max-height: 500px) {
  #lobby h1 { display: none; }
  #lobby .kicker { margin: 0 0 4px; }
  #lobby .note { margin: 3px 0 0; }
  #lobby .chip { font-size: 12px; padding: 2px 8px 2px 5px; }

  /* Step 1. Two doors of equal standing, so they go side by side rather than
     one above the other the moment there is room for it. */
  #lobby .choices { grid-template-columns: 1fr 1fr; margin: 10px 0 4px; }

  /* Step 2a, the keypad. The pictures and the six keys keep the full width —
     a row of six is a wide shape already — and the two buttons beneath them
     share a line instead of stacking. */
  #lobby .code-row { margin: 6px 0 2px; }
  #lobby .code-slot {
    width: 44px; height: 44px; line-height: 44px; font-size: 24px; border-radius: 12px;
  }
  #lobby .pad { gap: 5px; margin: 5px 0; }
  #lobby .pad button { font-size: 22px; padding: 4px 0; }
  #lobby-pad {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas:
      "note   note"
      "slots  slots"
      "keys   keys"
      "clear  go"
      "status status";
    gap: 6px 12px;
    align-items: center;
  }
  #pad-note { grid-area: note; }
  #pad-slots { grid-area: slots; }
  #pad-keys { grid-area: keys; }
  #pad-clear { grid-area: clear; margin: 0; }
  #pad-go { grid-area: go; margin: 0; width: 100%; }
  #pad-status { grid-area: status; }

  /* Step 2b, the room. The code stays the hero — it is still the largest
     thing on the screen — but at 64px beside the roster rather than 88px
     above it, which is the single change that takes this step off the
     scroll. The roster spans the three rows the code, its words and the
     status line occupy, so the block is as tall as whichever side is
     taller and no taller. */
  #lobby-room {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas:
      "code   roster"
      "words  roster"
      "status roster"
      "rules  roster"
      "blaze  blaze";
    gap: 2px 16px;
    align-content: center;
  }
  #lobby-code { grid-area: code; margin: 0; }
  #lobby-words { grid-area: words; }
  #lobby-status { grid-area: status; }
  #lobby-rules { grid-area: rules; }
  /* AND THE ROSTER GIVES UP THE WIDTH THE CORNER TAKES. This is the one step
     tall enough to reach the top of a sideways phone — six chips and an 88px
     code do not leave much of 300px — and what is up there on the right is the
     first roster row, under the menu/mute/fullscreen cluster. --corner-bite is
     css/style.css's, declared in the identical media query and derived there:
     it is how far the cluster reaches into a panel's content box, 0 on a wide
     phone and 108px on the narrowest. Every chip loses the same width rather
     than only the covered one, because a row of chips is a group and a group
     of equals looks equal (hub §2). The choose and keypad steps are short
     enough to sit clear of the band and are left alone. */
  #lobby-roster {
    grid-area: roster; margin: 0; align-self: center;
    padding-right: var(--corner-bite);
  }
  #lobby-blaze { grid-area: blaze; margin: 8px 0 0; }
  #lobby .code-row.hero .code-slot {
    width: 64px; height: 64px; line-height: 64px; font-size: 34px; border-radius: 16px;
  }
}
`;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/* A node made with data-i18n carries its key and gets its words now; the
 * repaint on a language switch is js/i18n.js's paintStatic. */
const label = (tag, className, key) => {
  const node = el(tag, className, t(key));
  node.dataset.i18n = key;
  return node;
};

/*
 * Write words that depend on state, and keep them: `words` is a function (or
 * a plain string, for something that is not language at all, like a player's
 * name), and every node written this way is said again when the language
 * changes. `cls`, when given, replaces the node's class in the same breath.
 */
const written = new Set();
function write(node, words, cls) {
  node._words = words;
  written.add(node);
  node.textContent = typeof words === "function" ? words() : (words ?? "");
  if (cls) node.className = cls;
}

/* What a failure means, as words: an error the net code raised with a key
 * (i18n.js said()) is said in whatever language is current, anything else
 * falls back to the plain sentence for that step. */
const meaning = (error, fallback) => () =>
  error?.key ? t(error.key, ...(error.args ?? [])) : t(fallback);

/* The same question ui.js asks before it shows the touch buttons: is this a
 * device steered by fingers? One answer, asked the same way, so the seat cap
 * below and the controls a player actually gets can never disagree. */
export function isCoarsePointer() {
  try {
    if (window.matchMedia("(pointer: coarse)").matches) return true;
  } catch {
    /* matchMedia is unavailable in some embedded contexts. */
  }
  return (navigator.maxTouchPoints ?? 0) > 0;
}

/* What each step calls itself. Kept together so the wording of the flow can
 * be read in one place rather than reconstructed from four assignments. */
const STEPS = {
  choose: {
    kicker: "lobby.choose.kicker",
    heading: "lobby.choose.title",
    back: "back",
  },
  pad: { kicker: "lobby.pad.kicker", heading: "lobby.pad.title", back: "back" },
  host: { kicker: "lobby.host.kicker", heading: null, back: "lobby.host.back" },
  guest: { kicker: "lobby.guest.kicker", heading: null, back: "lobby.guest.back" },
};

/*
 * ui: the UI instance, for showing and hiding the paddock.
 * onPlay(session): a match has begun and main.js should render it.
 */
export function createLobby({ root, ui, onPlay, onBack, onEnded, settings }) {
  const style = el("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const coarse = isCoarsePointer();
  let session = null;
  let unwatch = null;
  let entered = []; // symbol names tapped on the join keypad
  let step = "choose"; // 'choose' | 'pad' | 'host' | 'guest'

  const panel = el("section", "panel");
  panel.id = "lobby";
  panel.hidden = true;
  panel.dataset.i18nLabel = "multiplayer";
  panel.setAttribute("aria-label", t("multiplayer"));

  const kicker = el("p", "kicker");
  const heading = el("h1");
  panel.append(kicker, heading);

  /* ------------------------------------------------------- step 1: choose -- */

  const chooseView = el("div");

  /*
   * Your name, which is what the other device's scoreboard will call you.
   *
   * It starts on a name the game rolled rather than on an empty field with a
   * fixed "Fox" hint: that hint was a lie, because an empty field made
   * cleanName() roll something else entirely, so the screen said Fox and the
   * roster said Vapor. The placeholder now holds the name that will actually
   * be sent. The die writes into the VALUE rather than rolling a new
   * placeholder, because a name you asked for is a name you chose and grey
   * suggestion text would say otherwise — fishtank's reasoning, and its
   * control.
   */
  const nameRow = el("div", "row");
  const nameLabel = label("label", "label", "lobby.name");
  nameLabel.htmlFor = "lobby-name";
  const nameField = el("div", "slider"); // the same label + control geometry as a row
  const nameInput = el("input", "nameField");
  nameInput.id = "lobby-name";
  nameInput.type = "text";
  nameInput.maxLength = MAX_NAME;
  nameInput.autocomplete = "nickname";
  nameInput.spellcheck = false;
  nameInput.placeholder = rollName();
  try {
    nameInput.value = localStorage.getItem(NAME_KEY) || "";
  } catch {
    /* Private mode; the rolled placeholder stands (hub §6). */
  }
  const reroll = el("button", "reroll");
  reroll.type = "button";
  reroll.dataset.i18nLabel = "lobby.reroll";
  reroll.setAttribute("aria-label", t("lobby.reroll"));
  reroll.title = t("lobby.reroll");
  reroll.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<rect x="4" y="4" width="16" height="16" rx="4.5" />' +
    '<circle class="pip" cx="9" cy="9" r="1.4" />' +
    '<circle class="pip" cx="12" cy="12" r="1.4" />' +
    '<circle class="pip" cx="15" cy="15" r="1.4" />' +
    "</svg>";
  nameField.append(nameInput, reroll);
  nameRow.append(nameLabel, nameField);
  chooseView.append(nameRow);

  /*
   * Seats on this device are NOT asked for here — the paddock's Local players
   * row was answered on the way in. The owner's rule still holds and is still
   * enforced twice (here, and host-side in cleanSeats()), and this line says
   * so only when the clamp actually takes something away: a touch device
   * quietly seating one rider when the paddock was set to two is the kind of
   * silence that reads as a bug.
   */
  const seatNote = el("p", "note");
  seatNote.hidden = true;
  chooseView.append(seatNote);

  const choices = el("div", "choices");
  const hostBtn = label("button", "primary", "lobby.host");
  hostBtn.type = "button";
  const joinBtn = label("button", "primary together", "lobby.join");
  joinBtn.type = "button";
  choices.append(hostBtn, joinBtn);
  chooseView.append(choices);
  panel.append(chooseView);

  /* ------------------------------------------- step 2a: their code (join) -- */

  const padView = el("div");
  padView.id = "lobby-pad";
  padView.hidden = true;
  const padNote = label("p", "note", "lobby.padNote");
  padNote.id = "pad-note";
  padView.append(padNote);
  const slotRow = el("div", "code-row");
  slotRow.id = "pad-slots";
  padView.append(slotRow);
  const pad = el("div", "pad");
  pad.id = "pad-keys";
  for (const symbol of SYMBOLS) {
    const b = el("button", null, symbol.icon);
    b.type = "button";
    // The picture's name in this language; the wire still carries its id.
    b.dataset.i18nLabel = `sym.${symbol.name}`;
    b.setAttribute("aria-label", t(`sym.${symbol.name}`));
    b.addEventListener("click", () => {
      if (entered.length >= CODE_LENGTH) entered = [];
      entered.push(symbol.name);
      paintCode();
    });
    pad.append(b);
  }
  padView.append(pad);
  const clear = label("button", "ghost", "lobby.clear");
  clear.id = "pad-clear";
  clear.type = "button";
  clear.addEventListener("click", () => {
    entered = [];
    paintCode();
  });
  padView.append(clear);
  const joinGo = label("button", "primary", "lobby.go");
  joinGo.id = "pad-go";
  joinGo.type = "button";
  joinGo.disabled = true;
  padView.append(joinGo);
  const padStatus = el("p", "note");
  padStatus.id = "pad-status";
  padView.append(padStatus);
  panel.append(padView);

  /* --------------------------------------- step 2b: the lobby, for both -- */

  const lobbyView = el("div");
  lobbyView.id = "lobby-room";
  lobbyView.hidden = true;
  const codeRow = el("div", "code-row hero");
  codeRow.id = "lobby-code";
  lobbyView.append(codeRow);
  const codeWords = el("p", "note");
  codeWords.id = "lobby-words";
  lobbyView.append(codeWords);
  const lobbyStatus = el("p", "note live");
  lobbyStatus.id = "lobby-status";
  lobbyView.append(lobbyStatus);
  // The rules of this room — arena, turning, win at — which the host set in
  // the paddock and a guest has no other way of seeing. One line, in the
  // order the paddock asks them, painted from session.rules whenever the
  // roster is; both ends carry the same three names, so it reads the same on
  // every screen in the room.
  const rulesLine = el("p", "note");
  rulesLine.id = "lobby-rules";
  rulesLine.hidden = true;
  lobbyView.append(rulesLine);
  const rosterList = el("ul", "roster");
  rosterList.id = "lobby-roster";
  lobbyView.append(rosterList);
  // Only the host's. Starting is the host's call and nobody else's, so a
  // guest gets no button rather than one that does nothing.
  const blaze = label("button", "primary", "play");
  blaze.id = "lobby-blaze";
  blaze.type = "button";
  blaze.disabled = true;
  lobbyView.append(blaze);
  panel.append(lobbyView);

  const back = el("button", "ghost");
  back.type = "button";
  panel.append(back);
  root.append(panel);

  /* ---------------------------------------------------------- behaviour -- */

  /* The name that will actually be sent: what was typed, or the rolled
   * suggestion nobody bothered to change. Never an empty string, which is
   * what used to make cleanName() invent a third name behind the player. */
  const playerName = () => nameInput.value.trim() || nameInput.placeholder;

  /* One answer, read fresh every time a game is opened, so going back to the
   * paddock and changing Local players is picked up on the way in again. */
  const seats = () => (coarse ? 1 : Math.max(1, settings.humans()));

  /* The status line of whichever step is on screen. Both the session's own
   * reports and every failure go through here, so neither can end up written
   * to a paragraph nobody is looking at. */
  const statusLine = () => (step === "pad" ? padStatus : lobbyStatus);

  function showStep(next) {
    step = next;
    const words = STEPS[next];
    write(kicker, () => t(words.kicker));
    write(heading, () => (words.heading ? t(words.heading) : ""));
    heading.hidden = !words.heading;
    write(back, () => t(words.back));
    chooseView.hidden = next !== "choose";
    padView.hidden = next !== "pad";
    lobbyView.hidden = next !== "host" && next !== "guest";
    // A guest may not start the match, so the button is not merely disabled.
    blaze.hidden = next !== "host";
  }

  function paintSeatNote() {
    const clamped = coarse && settings.humans() > 1;
    seatNote.hidden = !clamped;
    if (clamped) write(seatNote, () => t("lobby.seats"));
  }

  function paintSlots(row, icons, empties) {
    row.textContent = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      const slot = el(
        "div",
        icons[i] ? "code-slot" : "code-slot empty",
        icons[i] ?? "?",
      );
      if (empties) slot.setAttribute("aria-hidden", "true");
      row.append(slot);
    }
  }

  function paintCode() {
    paintSlots(
      slotRow,
      entered.map((n) => SYMBOLS.find((s) => s.name === n).icon),
      true,
    );
    joinGo.disabled = entered.length !== CODE_LENGTH;
    const picked = [...entered];
    write(
      padStatus,
      () => (picked.length === CODE_LENGTH ? picked.map((n) => t(`sym.${n}`)).join(" · ") : ""),
      "note",
    );
  }

  /* The three pictures and the words under them, for whichever code this
   * device is holding — the one it opened, or the one it just got right. */
  function paintShared(code) {
    paintSlots(codeRow, code ? codeIcons(code) : [], true);
    write(codeWords, () =>
      code ? code.split("-").map((n) => t(`sym.${n}`)).join(" · ") : "",
    );
  }

  function paintRoster() {
    rosterList.textContent = "";
    for (const r of session?.roster ?? []) {
      const li = el("li", "chip");
      li.style.setProperty("--c", PALETTE[r.colorIndex]?.hex ?? "#46e6ff");
      const dot = el("span", "dot");
      const name = el("span", "name", r.name);
      // "bot", matching the paddock's own row. It said "rival" here and
      // "Rivals" there right up until the paddock was renamed.
      const kind = label("span", "pts", r.kind === "ai" ? "roster.bot" : "roster.rider");
      li.append(dot, name, kind);
      rosterList.append(li);
    }
    paintRules();
  }

  function paintRules() {
    const rules = session?.rules;
    rulesLine.hidden = !rules;
    if (!rules) return;
    // By index, from either end of the wire, so each device names the arena
    // and the turning in its own language.
    write(rulesLine, () =>
      t("rules", t(`arena.${rules.arena}`), t(`turn.${rules.turn}`), rules.target),
    );
  }

  nameInput.addEventListener("change", () => {
    try {
      localStorage.setItem(NAME_KEY, nameInput.value.trim());
    } catch {
      /* Private mode; the name just will not survive a reload. */
    }
  });

  reroll.addEventListener("click", () => {
    nameInput.value = rollName(playerName());
    try {
      localStorage.setItem(NAME_KEY, nameInput.value);
    } catch {
      /* Private mode; the roll just will not survive a reload. */
    }
  });

  function attach(next) {
    session = next;
    session.onRoster = paintRoster;
    // A key and its arguments, from host.js or guest.js — said here.
    session.onStatus = (key, ...args) => {
      write(statusLine(), () => t(key, ...args), "note live");
    };
    session.onBegin = () => {
      panel.hidden = true;
      onPlay(session);
    };
    session.onClosed = (why) => {
      session = null;
      // Two very different moments wear the same event. In the lobby it is a
      // refusal or a failure and belongs on a status line; once the match is
      // running (this panel hidden) it is the host closing their tab, and
      // main.js has to hear about it or it will keep pumping a dead session.
      if (panel.hidden) {
        onEnded?.(why);
        return;
      }
      // A guest thrown out before the match started has nothing left to look
      // at — the roster it was watching belongs to a room it is no longer in
      // — so it goes back to the keypad, where the code is still entered and
      // trying again is one tap.
      if (step === "guest") showStep("pad");
      if (why) fail(() => t(why));
    };
  }

  /* `words` is a function, so a failure still on screen follows a switch. */
  function fail(words) {
    write(statusLine(), words, "note warn");
  }

  async function openGame() {
    showStep("host");
    paintShared(null);
    paintRoster();
    write(lobbyStatus, () => t("status.opening"), "note live");
    blaze.disabled = true;
    try {
      const { hostSession } = await import("./host.js");
      const next = await hostSession({
        arenaIndex: settings.arenaIndex(),
        turnIndex: settings.turnIndex(),
        target: settings.target(),
        ais: settings.ais(),
        name: playerName(),
        seats: seats(),
        coarse,
        // What the gopher is wearing, so everyone else's screen dresses this
        // fox too; main.js answers it, since only main.js has the wardrobe.
        outfit: settings.outfit?.() ?? [],
      });
      attach(next);
      paintShared(next.code);
      blaze.disabled = false;
      paintRoster();
      const why = meaning(next.why, "err.brokerLoad");
      write(lobbyStatus, () =>
        next.mode === "tabs"
          ? t("status.tabs", why())
          : t(next.mode === "relay" ? "status.relay" : "status.waiting"),
      );
      // The broker drops a peer whose heartbeat stops, so report whether the
      // code is actually live rather than assuming it stayed live.
      unwatch = next.watch?.((health) => {
        if (!health.reachable) fail(() => t(health.note, ...(health.args ?? [])));
      });
    } catch (error) {
      fail(meaning(error, "status.openFail"));
    }
  }

  async function findGame() {
    const code = parseCode(entered.join("-"));
    if (!code) return;
    joinGo.disabled = true;
    write(padStatus, () => t("status.looking"), "note live");
    try {
      const { joinSession } = await import("./guest.js");
      const next = await joinSession({
        code,
        name: playerName(),
        seats: seats(),
        coarse,
        // What the gopher is wearing, so everyone else's screen dresses this
        // fox too; main.js answers it, since only main.js has the wardrobe.
        outfit: settings.outfit?.() ?? [],
      });
      // The code was right and somebody answered: the same room the host is
      // looking at, minus the button that starts it.
      attach(next);
      showStep("guest");
      paintShared(code);
      paintRoster();
      write(lobbyStatus, () => t("status.waitHost"), "note live");
    } catch (error) {
      joinGo.disabled = false;
      fail(meaning(error, "status.reachFail"));
    }
  }

  hostBtn.addEventListener("click", openGame);
  joinBtn.addEventListener("click", () => {
    entered = [];
    paintCode();
    showStep("pad");
  });
  joinGo.addEventListener("click", findGame);
  blaze.addEventListener("click", () => session?.startMatch?.());

  /* One button, three meanings, and it says which one it is: out of the
   * multiplayer screen altogether from the chooser, back one step from the
   * keypad, and out of a room that actually exists from the lobby. */
  back.addEventListener("click", () => {
    if (step === "choose") {
      tearDown();
      panel.hidden = true;
      onBack();
      return;
    }
    tearDown();
    showStep("choose");
  });

  function tearDown() {
    unwatch?.();
    unwatch = null;
    session?.leave();
    session = null;
    rosterList.textContent = "";
    rulesLine.hidden = true;
  }

  paintCode();
  paintShared(null);
  showStep("choose");

  /* A language switch while this screen is up: every data-i18n here is
   * js/i18n.js's to repaint (it walks the whole document, and this panel is
   * in it), and everything write() wrote is said again. No step changes and
   * no session is touched. */
  document.addEventListener("arcade:lang", () => {
    for (const node of written) {
      const words = node._words;
      node.textContent = typeof words === "function" ? words() : (words ?? "");
    }
  });
  paintStatic(panel);

  return {
    open() {
      ui.hideMenu();
      panel.hidden = false;
      entered = [];
      paintCode();
      paintSeatNote();
      showStep("choose");
    },
    /* Called when a net match ends or is abandoned: drop the connection and
     * get out of the way. The paddock is somebody else's to show. */
    close() {
      tearDown();
      panel.hidden = true;
    },
    get coarse() {
      return coarse;
    },
  };
}

/*
 * The way in. index.html is another lane's file, so this adopts a #together
 * button if one is there and makes one if it is not — the same markup either
 * way, so the day it lands in index.html nothing here changes.
 */
export function mountEntry(onClick) {
  // Already in the markup means ui.js has already wired it, so touching it
  // here would fire the callback twice. Do nothing and say so by returning it.
  const existing = document.getElementById("together");
  if (existing) return existing;
  const start = document.getElementById("start");
  if (!start) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.id = "together";
  // The same pill Blaze! wears, because the paddock gives its two doors equal
  // weight; #start sits inside the .play row, so inserting after it lands
  // this in that row and the pair shares its width evenly either way.
  button.className = "primary together";
  button.dataset.i18n = "multiplayer";
  button.textContent = t("multiplayer");
  start.insertAdjacentElement("afterend", button);
  button.addEventListener("click", onClick);
  return button;
}
