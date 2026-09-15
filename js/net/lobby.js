/*
 * lobby.js — the screen where a game is opened or found.
 *
 * Menus belong to the game (hub CLAUDE.md §2), so this one is built out of
 * the paddock's own parts: the same .panel over the same live attract arena,
 * the same .seg pills, the same .primary and .ghost buttons, the same .chip
 * rows the scoreboard uses. The two controls the paddock has no precedent for
 * — a name field and a keypad of pictures — get the handful of rules at the
 * top of this file, written against the palette's own custom properties so
 * they cannot drift from it. Nothing here is a bare OS control.
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
import { MAX_NAME } from "./protocol.js";
import { PALETTE } from "../config.js";

const NAME_KEY = "neonfox.netname.v1";

const CSS = `
#lobby .code-row { display: flex; gap: 10px; justify-content: center; margin: 14px 0 6px; }
#lobby .code-slot {
  width: 56px; height: 56px; line-height: 56px; font-size: 30px; text-align: center;
  border-radius: 14px; border: 1px solid var(--line); background: rgba(70,230,255,0.07);
}
#lobby .code-slot.empty { color: var(--ink-dim); font-size: 20px; }
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
#lobby .roster { list-style: none; margin: 12px 0 4px; padding: 0; display: grid; gap: 6px; }
#lobby .note { color: var(--ink-dim); font-size: 12px; margin: 6px 0 0; line-height: 1.5; }
#lobby .live { color: var(--rim); }
#lobby .warn { color: #ffa03c; }
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

  const panel = el("section", "panel");
  panel.id = "lobby";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Multiplayer");

  panel.append(el("p", "kicker", "Ride with a friend"));
  const heading = el("h1", null, "Together");
  panel.append(heading);

  /* Host or join. One row, set once, so pills beat a dropdown (hub §2). */
  const modeRow = el("div", "row");
  modeRow.append(el("span", "label", "Game"));
  const modeSeg = el("div", "seg");
  modeSeg.setAttribute("role", "group");
  modeSeg.setAttribute("aria-label", "Open a game or find one");
  const hostBtn = el("button", null, "Open one");
  const joinBtn = el("button", null, "Find one");
  for (const [b, v] of [
    [hostBtn, "host"],
    [joinBtn, "join"],
  ]) {
    b.type = "button";
    b.dataset.v = v;
    b.setAttribute("aria-pressed", String(v === "host"));
    modeSeg.append(b);
  }
  modeRow.append(modeSeg);
  panel.append(modeRow);

  /* Your name, which is what the other device's scoreboard will call you. */
  const nameRow = el("div", "row");
  const nameLabel = el("label", "label", "You are");
  nameLabel.htmlFor = "lobby-name";
  const nameInput = el("input", "nameField");
  nameInput.id = "lobby-name";
  nameInput.type = "text";
  nameInput.maxLength = MAX_NAME;
  nameInput.autocomplete = "off";
  nameInput.spellcheck = false;
  nameInput.placeholder = "Fox";
  try {
    nameInput.value = localStorage.getItem(NAME_KEY) || "";
  } catch {
    /* Private mode; the field simply starts empty (hub §6). */
  }
  nameRow.append(nameLabel, nameInput);
  panel.append(nameRow);

  /* Seats on THIS device. The owner's rule, said out loud rather than
   * enforced in silence: a phone has one pair of buttons and one person
   * holding it, so it brings one rider. A keyboard can still seat two. */
  const seatRow = el("div", "row");
  seatRow.append(el("span", "label", "Riders"));
  const seatSeg = el("div", "seg");
  seatSeg.setAttribute("role", "group");
  seatSeg.setAttribute("aria-label", "Riders from this device");
  const seat1 = el("button", null, "Just me");
  const seat2 = el("button", null, "Two, one keyboard");
  for (const [b, v] of [
    [seat1, "1"],
    [seat2, "2"],
  ]) {
    b.type = "button";
    b.dataset.v = v;
    b.setAttribute("aria-pressed", String(v === "1"));
    seatSeg.append(b);
  }
  if (coarse) {
    seat2.disabled = true;
    seat2.title = "One rider per phone or tablet";
  }
  seatRow.append(seatSeg);
  panel.append(seatRow);
  const seatNote = el(
    "p",
    "note",
    coarse
      ? "This is a touch device, so it brings one rider: one pair of buttons, one pair of hands. A computer at the other end can still seat two on its keyboard."
      : "Two riders share this keyboard — arrows and A/D — and count as two of the six.",
  );
  panel.append(seatNote);

  /* ------------------------------------------------------------ hosting -- */

  const hostView = el("div");
  hostView.append(
    el(
      "p",
      "note",
      "Read these three pictures out to your friend, or send them the word:",
    ),
  );
  const codeRow = el("div", "code-row");
  hostView.append(codeRow);
  const codeWords = el("p", "note");
  hostView.append(codeWords);
  const hostStatus = el("p", "note live", "Opening a game…");
  hostView.append(hostStatus);
  const rosterList = el("ul", "roster");
  hostView.append(rosterList);
  const blaze = el("button", "primary", "Blaze!");
  blaze.type = "button";
  blaze.disabled = true;
  hostView.append(blaze);
  panel.append(hostView);

  /* ------------------------------------------------------------- joining -- */

  const joinView = el("div");
  joinView.hidden = true;
  joinView.append(
    el("p", "note", "Tap the three pictures your friend reads out:"),
  );
  const slotRow = el("div", "code-row");
  joinView.append(slotRow);
  const pad = el("div", "pad");
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
  joinView.append(pad);
  const clear = el("button", "ghost", "Start the code again");
  clear.type = "button";
  clear.addEventListener("click", () => {
    entered = [];
    paintCode();
  });
  joinView.append(clear);
  const joinGo = el("button", "primary", "Join the game");
  joinGo.type = "button";
  joinGo.disabled = true;
  joinView.append(joinGo);
  const joinStatus = el("p", "note");
  joinView.append(joinStatus);
  panel.append(joinView);

  const back = el("button", "ghost", "Back to the paddock");
  back.type = "button";
  panel.append(back);
  root.append(panel);

  /* ---------------------------------------------------------- behaviour -- */

  const pressed = (seg) =>
    seg.querySelector('button[aria-pressed="true"]')?.dataset.v;

  function wireSeg(seg, onChange) {
    seg.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || button.disabled || button.parentElement !== seg) return;
      for (const sibling of seg.querySelectorAll("button"))
        sibling.setAttribute("aria-pressed", String(sibling === button));
      onChange();
    });
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
    joinStatus.textContent =
      entered.length === CODE_LENGTH ? entered.join(" · ") : "";
    joinStatus.className = "note";
  }

  function paintRoster() {
    rosterList.textContent = "";
    for (const r of session?.roster ?? []) {
      const li = el("li", "chip");
      li.style.setProperty("--c", PALETTE[r.colorIndex]?.hex ?? "#46e6ff");
      const dot = el("span", "dot");
      const name = el("span", "name", r.name);
      const kind = el("span", "pts", r.kind === "ai" ? "rival" : "rider");
      li.append(dot, name, kind);
      rosterList.append(li);
    }
  }

  function showMode(which) {
    hostView.hidden = which !== "host";
    joinView.hidden = which !== "join";
    heading.textContent = which === "host" ? "Together" : "Find a game";
  }

  wireSeg(modeSeg, () => {
    tearDown();
    showMode(pressed(modeSeg));
    if (pressed(modeSeg) === "host") openGame();
  });
  wireSeg(seatSeg, () => {
    // Changing your own seat count reopens the game, because the roster it
    // handed out is now wrong. Cheap: nobody has joined yet in practice.
    if (pressed(modeSeg) === "host" && session) {
      tearDown();
      openGame();
    }
  });

  nameInput.addEventListener("change", () => {
    try {
      localStorage.setItem(NAME_KEY, nameInput.value.trim());
    } catch {
      /* Private mode; the name just will not survive a reload. */
    }
  });

  const seats = () => (coarse ? 1 : Number(pressed(seatSeg)) || 1);

  function attach(next) {
    session = next;
    session.onRoster = paintRoster;
    session.onStatus = (text) => {
      const line = pressed(modeSeg) === "host" ? hostStatus : joinStatus;
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
      // refusal or a failure and belongs on the status line; once the match
      // is running (this panel hidden) it is the host closing their tab, and
      // main.js has to hear about it or it will keep pumping a dead session.
      if (panel.hidden) onEnded?.(why);
      else if (why) fail(why);
    };
  }

  function fail(text) {
    const line = pressed(modeSeg) === "host" ? hostStatus : joinStatus;
    line.textContent = text;
    line.className = "note warn";
  }

  async function openGame() {
    hostStatus.textContent = "Opening a game…";
    hostStatus.className = "note live";
    blaze.disabled = true;
    paintSlots(codeRow, [], true);
    codeWords.textContent = "";
    try {
      const { hostSession } = await import("./host.js");
      const next = await hostSession({
        arenaIndex: settings.arenaIndex(),
        target: settings.target(),
        ais: settings.ais(),
        name: nameInput.value,
        seats: seats(),
        coarse,
      });
      attach(next);
      paintSlots(codeRow, codeIcons(next.code), true);
      codeWords.textContent = next.code.replace(/-/g, " · ");
      blaze.disabled = false;
      paintRoster();
      hostStatus.textContent =
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
    joinStatus.textContent = "Looking for the game…";
    joinStatus.className = "note live";
    try {
      const { joinSession } = await import("./guest.js");
      attach(
        await joinSession({
          code,
          name: nameInput.value,
          seats: seats(),
          coarse,
        }),
      );
    } catch (error) {
      joinGo.disabled = false;
      fail(error.message || "Could not reach that game.");
    }
  }

  joinGo.addEventListener("click", findGame);
  blaze.addEventListener("click", () => session?.startMatch?.());
  back.addEventListener("click", () => {
    tearDown();
    panel.hidden = true;
    onBack();
  });

  function tearDown() {
    unwatch?.();
    unwatch = null;
    session?.leave();
    session = null;
    rosterList.textContent = "";
  }

  paintCode();
  paintSlots(codeRow, [], true);

  return {
    open() {
      ui.hideMenu();
      panel.hidden = false;
      entered = [];
      paintCode();
      showMode(pressed(modeSeg));
      if (pressed(modeSeg) === "host") openGame();
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
