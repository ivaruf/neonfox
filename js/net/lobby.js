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
 * Language is the game's: you open a game rather than create a session, and
 * the button that starts it says Blaze! like the one next door.
 */

import { SYMBOLS, CODE_LENGTH, codeIcons, parseCode } from "./codes.js";
import { MAX_NAME, rollName } from "./protocol.js";
import { PALETTE } from "../config.js";

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
  #lobby-roster { grid-area: roster; margin: 0; align-self: center; }
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
    kicker: "Ride with a friend",
    heading: "Together",
    back: "Back to the paddock",
  },
  pad: { kicker: "Find a game", heading: "Their code", back: "Back" },
  host: {
    kicker: "Read these out to your friend",
    heading: null,
    back: "Close this game",
  },
  guest: { kicker: "You are in", heading: null, back: "Leave this game" },
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
  panel.setAttribute("aria-label", "Multiplayer");

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
  const nameLabel = el("label", "label", "You are");
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
  reroll.setAttribute("aria-label", "Roll another name");
  reroll.title = "Roll another name";
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
  const hostBtn = el("button", "primary", "Host game");
  hostBtn.type = "button";
  const joinBtn = el("button", "primary together", "Join game");
  joinBtn.type = "button";
  choices.append(hostBtn, joinBtn);
  chooseView.append(choices);
  panel.append(chooseView);

  /* ------------------------------------------- step 2a: their code (join) -- */

  const padView = el("div");
  padView.id = "lobby-pad";
  padView.hidden = true;
  const padNote = el(
    "p",
    "note",
    "Tap the three pictures your friend reads out:",
  );
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
    b.setAttribute("aria-label", symbol.name);
    b.addEventListener("click", () => {
      if (entered.length >= CODE_LENGTH) entered = [];
      entered.push(symbol.name);
      paintCode();
    });
    pad.append(b);
  }
  padView.append(pad);
  const clear = el("button", "ghost", "Start the code again");
  clear.id = "pad-clear";
  clear.type = "button";
  clear.addEventListener("click", () => {
    entered = [];
    paintCode();
  });
  padView.append(clear);
  const joinGo = el("button", "primary", "Join the game");
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
  const blaze = el("button", "primary", "Blaze!");
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
    kicker.textContent = words.kicker;
    heading.textContent = words.heading ?? "";
    heading.hidden = !words.heading;
    back.textContent = words.back;
    chooseView.hidden = next !== "choose";
    padView.hidden = next !== "pad";
    lobbyView.hidden = next !== "host" && next !== "guest";
    // A guest may not start the match, so the button is not merely disabled.
    blaze.hidden = next !== "host";
  }

  function paintSeatNote() {
    const clamped = coarse && settings.humans() > 1;
    seatNote.hidden = !clamped;
    if (clamped) {
      seatNote.textContent =
        "Touch device, so it brings one rider: one pair of buttons, one pair of hands. The second seat needs a keyboard.";
    }
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
    padStatus.textContent =
      entered.length === CODE_LENGTH ? entered.join(" · ") : "";
    padStatus.className = "note";
  }

  /* The three pictures and the words under them, for whichever code this
   * device is holding — the one it opened, or the one it just got right. */
  function paintShared(code) {
    paintSlots(codeRow, code ? codeIcons(code) : [], true);
    codeWords.textContent = code ? code.replace(/-/g, " · ") : "";
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
      const kind = el("span", "pts", r.kind === "ai" ? "bot" : "rider");
      li.append(dot, name, kind);
      rosterList.append(li);
    }
    paintRules();
  }

  function paintRules() {
    const rules = session?.rules;
    rulesLine.hidden = !rules;
    if (!rules) return;
    rulesLine.textContent = `${rules.arenaName} arena · ${rules.turnName} turning · first to ${rules.target}`;
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
    session.onStatus = (text) => {
      const line = statusLine();
      line.textContent = text;
      line.className = "note live";
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
      if (why) fail(why);
    };
  }

  function fail(text) {
    const line = statusLine();
    line.textContent = text;
    line.className = "note warn";
  }

  async function openGame() {
    showStep("host");
    paintShared(null);
    paintRoster();
    lobbyStatus.textContent = "Opening a game…";
    lobbyStatus.className = "note live";
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
      });
      attach(next);
      paintShared(next.code);
      blaze.disabled = false;
      paintRoster();
      lobbyStatus.textContent =
        next.mode === "tabs"
          ? `Only other tabs in this browser can reach you: ${next.detail}`
          : next.mode === "relay"
            ? "Your own relay is carrying the introductions."
            : "Waiting for someone to join. Keep this screen awake.";
      // The broker drops a peer whose heartbeat stops, so report whether the
      // code is actually live rather than assuming it stayed live.
      unwatch = next.watch?.((health) => {
        if (!health.reachable) fail(health.note);
      });
    } catch (error) {
      fail(error.message || "Could not open a game.");
    }
  }

  async function findGame() {
    const code = parseCode(entered.join("-"));
    if (!code) return;
    joinGo.disabled = true;
    padStatus.textContent = "Looking for the game…";
    padStatus.className = "note live";
    try {
      const { joinSession } = await import("./guest.js");
      const next = await joinSession({
        code,
        name: playerName(),
        seats: seats(),
        coarse,
      });
      // The code was right and somebody answered: the same room the host is
      // looking at, minus the button that starts it.
      attach(next);
      showStep("guest");
      paintShared(code);
      paintRoster();
      lobbyStatus.textContent = "Waiting for the host to start.";
      lobbyStatus.className = "note live";
    } catch (error) {
      joinGo.disabled = false;
      fail(error.message || "Could not reach that game.");
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
  button.textContent = "Multiplayer";
  start.insertAdjacentElement("afterend", button);
  button.addEventListener("click", onClick);
  return button;
}
