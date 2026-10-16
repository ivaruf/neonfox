/*
 * i18n.js — every word NeonFox says, in bokmål and in English.
 *
 * NORWEGIAN FIRST, AND THE CHOICE IS THE HUB'S (hub CLAUDE.md §2, "Two
 * languages, Norwegian first"). With nothing valid stored the game speaks
 * bokmål whatever the browser prefers — no navigator.language sniffing, which
 * is the one place this differs from kitchens/js/i18n.js, the shape it was
 * copied from. The choice lives in `arcade.lang.v1`, one key for every game on
 * the origin, because a language is a fact about the player rather than the
 * cabinet. It holds "nb" or "en" and nothing else; any other value is ignored.
 *
 * THE FOUR NAMES. t(key, ...args) looks the key up in the current language,
 * then English, then gives the key back itself and warns once in the console.
 * getLang() is the current code. setLang(lang) validates, stores, sets
 * <html lang>, repaints every [data-i18n] in the page and then announces
 * `arcade:lang` on document — js/ui.js, js/net/lobby.js, js/screen.js and
 * js/update.js all listen for it and repaint what they wrote themselves.
 * paintStatic(root) is the repaint: [data-i18n] gets its textContent and
 * [data-i18n-label] its aria-label and title.
 *
 * VALUES MAY BE FUNCTIONS, because a language is not a template with blanks in
 * it: "1 pts" is wrong in English and "poeng" never changes in Norwegian, and
 * "Riding with Bolt" is "Følger Bolt" — a different verb, not a swapped word.
 *
 * NOTHING HERE EVER CROSSES THE WIRE. In a net match the host sends keys and
 * numbers (a refusal reason, an arena index), and each device renders them in
 * its own language through this file. A Norwegian host and an English guest
 * each read their own words. Player names are the exception that proves it:
 * they are typed, so they are never translated.
 *
 * Not translated: the game's name and logo, names players type, the manifest,
 * console output and storage keys (hub §2).
 *
 * The <html lang> is first set by the inline script at the top of index.html,
 * before anything paints; the module below agrees with it rather than racing
 * it, so a Norwegian page never flashes English and vice versa.
 */

const LANG_KEY = "arcade.lang.v1";
const LANGS = ["nb", "en"];

function stored() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch {
    // No storage (private mode, a blocked origin): the default applies.
  }
  return "nb";
}

let lang = stored();
document.documentElement.lang = lang;

export const getLang = () => lang;

/* Number formatting, where the game formats numbers at all (it mostly does not). */
export const locale = () => (lang === "nb" ? "nb-NO" : "en-GB");

export function setLang(next) {
  if (!LANGS.includes(next)) return;
  lang = next;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Not remembered; this visit still switches.
  }
  paintStatic();
  document.dispatchEvent(new CustomEvent("arcade:lang", { detail: lang }));
}

const warned = new Set();

export function t(key, ...args) {
  let v = STRINGS[lang][key];
  if (v === undefined) v = STRINGS.en[key];
  if (v === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`NeonFox: no text for "${key}"`);
    }
    return key;
  }
  return typeof v === "function" ? v(...args) : v;
}

/** Every [data-i18n] gets its words; every [data-i18n-label] its aria-label and title. */
export function paintStatic(root = document) {
  for (const n of root.querySelectorAll("[data-i18n]")) n.textContent = t(n.dataset.i18n);
  for (const n of root.querySelectorAll("[data-i18n-label]")) {
    const words = t(n.dataset.i18nLabel);
    n.setAttribute("aria-label", words);
    n.title = words;
  }
}

/*
 * An Error that remembers what it meant, so a failure raised deep in the net
 * code can be said again in the other language if the player switches while
 * it is still on screen. js/net/lobby.js reads .key and .args; anything else
 * that catches one still gets a readable .message.
 */
export function said(key, ...args) {
  const error = new Error(t(key, ...args));
  error.key = key;
  error.args = args;
  return error;
}

/* The three code pictures, by the English id the wire carries, said aloud. */
const sym = (id) => t(`sym.${id}`);
const codeWords = (code) => String(code).split("-").map(sym).join(" · ");

const STRINGS = {
  nb: {
    // The start screen.
    kicker: "Neon-Kurve for kuleryttere",
    "arena.label": "NeonFox-arenaen",
    "row.players": "Spillere",
    "mode.solo": "Alene",
    "mode.two": "To spillere",
    "row.bots": "Roboter",
    "row.arena": "Arena",
    "row.turn": "Svinger",
    "row.target": "Spill til",
    play: "Spill",
    multiplayer: "Flerspiller",
    "hint.steer": "styrer",
    "hint.two": "spiller to på",
    "hint.pause": "pause",
    "hint.aim": "styr mens runden starter for å sikte",
    pts: (n) => `${n} poeng`,
    "arena.0": "Bitteliten",
    "arena.1": "Trang",
    "arena.2": "Klassisk",
    "arena.3": "Romslig",
    "arena.4": "Enorm",
    "turn.0": "Hårnål",
    "turn.1": "Klassisk",
    "turn.2": "Vid",
    "turn.3": "Svev",
    "exit.arcade": "Tilbake til arkaden",
    "exit.close": "Lukk",
    "exit.refused": "Lukk fanen selv",

    // The corner and the menu panel.
    menu: "Meny",
    "menu.title": "Meny (Esc)",
    mute: "Lyd av",
    unmute: "Lyd på",
    "lang.label": "Språk",
    "row.music": "Musikk",
    "row.sfx": "Effekter",
    resume: "Fortsett",
    restart: "Start på nytt",
    "quit.match": "Avslutt kampen",
    back: "Tilbake",
    "pause.kicker": "Ingenting rører seg før du sier fra",
    "pause.title": "Pause",
    "pause.note": "Arenaen står helt stille. Fortsett der du slapp – eller la være.",
    "live.kicker": "Runden fortsetter uten deg",
    "live.title": "Meny",
    "live.note":
      "Et spill på flere skjermer kan ikke stoppes fra bare én av dem. Reven din er fortsatt der ute, og pilene styrer den fortsatt.",
    "settings.kicker": "Lyd og språk",
    "settings.title": "Innstillinger",
    "settings.note":
      "Musikken går under hele kampen. Effekter er bjeffene, krasjene og fanfaren – dra i den, så hører du det.",
    "settings.muted":
      "All lyd er av – trykk på høyttaleren i hjørnet eller dra i en glidebryter, så kommer den tilbake.",

    // In play.
    "hud.first": (n) => `Først til ${n}`,
    "name.you": "Du",
    "banner.steer": "Styr for å sikte",
    "banner.round": (n) => `Runde ${n}`,
    "banner.go": "Kjør!",
    "win.you": "Du vant!",
    "win.youMatch": "Du vant kampen!",
    "win.round": (name) => `${name} tar runden`,
    "win.match": (name) => `${name} vant kampen!`,
    "crash.all": "Alle krasjet",
    "crash.sub": "ingen vinner denne runden",
    "match.first": (n) => `først til ${n}`,
    "net.ended": "Spillet er slutt.",
    "net.endedSub": "ingen vert, ingen kamp",
    rematch: "Spill igjen",
    "to.menu": "Tilbake til menyen",
    "spectate.overview": "Oversikt",
    "spectate.with": (name) => `Følger ${name}`,
    "spectate.switch": "bytt visning",
    skip: "Hopp fram",
    "turn.left": "Sving til venstre",
    "turn.right": "Sving til høyre",
    "crash.babylon":
      "Babylon.js kunne ikke lastes – både CDN-kopien og vendor/babylon.js ble blokkert. Se etter babylon.js i loggen til innholdsblokkeren din.",

    // Multiplayer.
    "lobby.choose.kicker": "Kjør sammen med en venn",
    "lobby.choose.title": "Flerspiller",
    "lobby.pad.kicker": "Finn et spill",
    "lobby.pad.title": "Skriv inn koden",
    "lobby.host.kicker": "Les disse opp for vennen din",
    "lobby.host.back": "Lukk spillet",
    "lobby.guest.kicker": "Du er med",
    "lobby.guest.back": "Gå ut av spillet",
    "lobby.name": "Navn",
    "lobby.reroll": "Trill et nytt navn",
    "lobby.seats":
      "Berøringsskjerm, så den tar med én spiller: ett par knapper, ett par hender. Spiller nummer to trenger tastatur.",
    "lobby.host": "Lag et spill",
    "lobby.join": "Bli med",
    "lobby.padNote": "Trykk på de tre bildene vennen din leser opp:",
    "lobby.clear": "Visk ut koden",
    "lobby.go": "Bli med",
    "roster.bot": "robot",
    "roster.rider": "spiller",
    rules: (arena, turn, n) => `Arena: ${arena} · Svinger: ${turn} · først til ${n}`,
    "status.opening": "Lager et spill …",
    "status.tabs": (why) => `Bare andre faner i denne nettleseren kan nå deg: ${why}`,
    "status.relay": "Ditt eget relé tar seg av introduksjonene.",
    "status.nearby": "Uten nett: Gopher Connect leter etter telefoner i nærheten over Bluetooth.",
    "status.waiting": "Venter på at noen blir med. Ikke la skjermen sovne.",
    "status.openFail": "Fikk ikke laget et spill.",
    "status.looking": "Leter etter spillet …",
    "status.waitHost": "Venter på at verten starter.",
    "status.reachFail": "Fikk ikke kontakt med det spillet.",
    "status.in": "Du er med. Venter på at verten starter.",
    "status.spectator": "En kamp er allerede i gang – du ser på denne.",
    "status.left": (name) => `${name} gikk.`,
    "status.dropped": "Noen falt ut.",
    "status.watching": (name) => `${name} ser på.`,
    "status.joined": (name) => `${name} ble med.`,
    "status.joinedSome": (name, n) =>
      `${name} ble med, men det var bare plass til ${n} av spillerne deres.`,
    "why.version": "Den enheten har en annen versjon av NeonFox. Last inn begge på nytt og prøv igjen.",
    "why.full": "Spillet er fullt – arenaen har plass til seks spillere.",
    "why.refused": "Verten slapp ikke inn denne enheten.",
    "why.hostLeft": "Verten gikk, så spillet er slutt.",
    "err.notCode": "Det er ikke en kode. Trykk på tre bilder.",
    "err.offline": "Du er frakoblet, så det er ingen måte å finne den andre enheten på.",
    "err.brokerLoad": "Koden som finner andre spillere kunne ikke lastes, verken fra CDN-et eller fra denne siden.",
    "err.brokerBroken": "Koden som finner andre spillere ble lastet, men virker ikke.",
    "err.timeout": "Det tok for lang tid å finne hverandre.",
    "err.codeInUse": "Den koden er allerede i bruk. Lag et nytt spill for å få en ny.",
    "err.matchFailed": (type) => `Fant ikke hverandre (${type}).`,
    "err.reopening": "Åpner rommet igjen – koden virker kanskje ikke akkurat nå.",
    "err.codeTaken": "Noe annet tok denne koden. Lag et nytt spill for å få en ny.",
    "err.trouble": (type) => `Trøbbel med å finne hverandre (${type}).`,
    "err.noGame": (code) =>
      `Fant ikke noe spill med koden ${codeWords(code)}. Sjekk koden, og at vennen din fortsatt har spillet åpent og skjermen våken.`,
    "err.noReach": (type) => `Fikk ikke kontakt med spillet (${type}).`,
    "err.noAnswer": "Verten svarte ikke.",
    "err.nearbyRefused": (why) => `Gopher Connect sa nei: ${why}`,
    "err.nearbyGone": "Gopher Connect stoppet. Åpne appen og prøv igjen.",
    "err.nearbyNoHost": (code) =>
      `Fant ingen telefon i nærheten med koden ${codeWords(code)}. Sjekk koden, at Bluetooth er på, og at Gopher Connect kjører på begge telefonene.`,
    "err.rtcNoAnswer":
      "Verten svarte aldri. Sjekk koden – noen nettverk når rett og slett ikke hverandre.",
    "sym.fox": "rev",
    "sym.duck": "and",
    "sym.bee": "bie",
    "sym.car": "bil",
    "sym.rocket": "rakett",
    "sym.pizza": "pizza",
    "sym.tree": "tre",
    "sym.star": "stjerne",
    "sym.moon": "måne",
    "sym.key": "nøkkel",
    "sym.hat": "hatt",
    "sym.ball": "ball",
  },

  en: {
    kicker: "Neon Kurve for orb riders",
    "arena.label": "NeonFox arena",
    "row.players": "Players",
    "mode.solo": "Solo",
    "mode.two": "Two players",
    "row.bots": "Bots",
    "row.arena": "Arena",
    "row.turn": "Turning",
    "row.target": "Win at",
    play: "Play",
    multiplayer: "Multiplayer",
    "hint.steer": "steer",
    "hint.two": "rider two on",
    "hint.pause": "pauses",
    "hint.aim": "steer while the round loads to aim",
    pts: (n) => `${n} pts`,
    "arena.0": "Tiny",
    "arena.1": "Snug",
    "arena.2": "Classic",
    "arena.3": "Roomy",
    "arena.4": "Vast",
    "turn.0": "Hairpin",
    "turn.1": "Classic",
    "turn.2": "Wide",
    "turn.3": "Glide",
    "exit.arcade": "Back to arcade",
    "exit.close": "Close",
    "exit.refused": "Close this tab yourself",

    menu: "Menu",
    "menu.title": "Menu (Esc)",
    mute: "Mute",
    unmute: "Unmute",
    "lang.label": "Language",
    "row.music": "Music",
    "row.sfx": "Effects",
    resume: "Resume",
    restart: "Restart",
    "quit.match": "Quit match",
    back: "Back",
    "pause.kicker": "Nothing moves until you say so",
    "pause.title": "Paused",
    "pause.note": "The arena is holding still. Pick up where you left off, or don't.",
    "live.kicker": "The round carries on without you",
    "live.title": "Menu",
    "live.note":
      "A game on two screens cannot be stopped from one of them. Your fox is still out there, and the arrows still steer it.",
    "settings.kicker": "Sound and language",
    "settings.title": "Settings",
    "settings.note":
      "The theme rides under the whole match. Effects are the yips, the crashes and the fanfare — drag that one and you will hear it.",
    "settings.muted":
      "Everything is muted — tap the speaker in the corner, or move a slider, and the arena comes back.",

    "hud.first": (n) => `First to ${n}`,
    "name.you": "You",
    "banner.steer": "Steer to aim",
    "banner.round": (n) => `Round ${n}`,
    "banner.go": "Go!",
    "win.you": "You win!",
    "win.youMatch": "You win the match!",
    "win.round": (name) => `${name} takes the round`,
    "win.match": (name) => `${name} wins the match!`,
    "crash.all": "Everyone crashed",
    "crash.sub": "no winner this round",
    "match.first": (n) => `first to ${n}`,
    "net.ended": "The game ended.",
    "net.endedSub": "no host, no game",
    rematch: "Rematch",
    "to.menu": "Back to menu",
    "spectate.overview": "Overview",
    "spectate.with": (name) => `Riding with ${name}`,
    "spectate.switch": "switch view",
    skip: "Skip ahead",
    "turn.left": "Turn left",
    "turn.right": "Turn right",
    "crash.babylon":
      "Babylon.js could not load — both the CDN copy and vendor/babylon.js were blocked. Check your content blocker's request log for babylon.js.",

    "lobby.choose.kicker": "Ride with a friend",
    "lobby.choose.title": "Multiplayer",
    "lobby.pad.kicker": "Find a game",
    "lobby.pad.title": "Enter code",
    "lobby.host.kicker": "Read these out to your friend",
    "lobby.host.back": "Close game",
    "lobby.guest.kicker": "You are in",
    "lobby.guest.back": "Leave game",
    "lobby.name": "Name",
    "lobby.reroll": "Roll another name",
    "lobby.seats":
      "Touch device, so it brings one rider: one pair of buttons, one pair of hands. The second seat needs a keyboard.",
    "lobby.host": "Host game",
    "lobby.join": "Join game",
    "lobby.padNote": "Tap the three pictures your friend reads out:",
    "lobby.clear": "Clear code",
    "lobby.go": "Join",
    "roster.bot": "bot",
    "roster.rider": "rider",
    rules: (arena, turn, n) => `${arena} arena · ${turn} turning · first to ${n}`,
    "status.opening": "Opening a game…",
    "status.tabs": (why) => `Only other tabs in this browser can reach you: ${why}`,
    "status.relay": "Your own relay is carrying the introductions.",
    "status.nearby": "No network: Gopher Connect is looking for phones nearby over Bluetooth.",
    "status.waiting": "Waiting for someone to join. Keep this screen awake.",
    "status.openFail": "Could not open a game.",
    "status.looking": "Looking for the game…",
    "status.waitHost": "Waiting for the host to start.",
    "status.reachFail": "Could not reach that game.",
    "status.in": "You are in. Waiting for the host to start.",
    "status.spectator": "A match is already running — you are watching this one.",
    "status.left": (name) => `${name} left.`,
    "status.dropped": "Someone dropped out.",
    "status.watching": (name) => `${name} is watching.`,
    "status.joined": (name) => `${name} joined.`,
    "status.joinedSome": (name, n) =>
      `${name} joined, with room for ${n} of their ${n === 1 ? "rider" : "riders"}.`,
    "why.version": "That device is running a different build of NeonFox. Reload both and try again.",
    "why.full": "This game is full — six riders is the most the arena holds.",
    "why.refused": "The host turned this device away.",
    "why.hostLeft": "The host left, so the game is over.",
    "err.notCode": "That is not a code. Tap three pictures.",
    "err.offline": "You are offline, so there is no way to find the other device.",
    "err.brokerLoad": "The matchmaking code could not load, from the CDN or from this site.",
    "err.brokerBroken": "The matchmaking code loaded but is unusable.",
    "err.timeout": "Matchmaking timed out.",
    "err.codeInUse": "That code is already in use. Host again for a fresh one.",
    "err.matchFailed": (type) => `Matchmaking failed (${type}).`,
    "err.reopening": "Reopening the room — the code may not work just now.",
    "err.codeTaken": "Something else took this code. Host again for a fresh one.",
    "err.trouble": (type) => `Matchmaking trouble (${type}).`,
    "err.noGame": (code) =>
      `No game found with code ${codeWords(code)}. Check the code, and that your friend still has the lobby open with their screen awake.`,
    "err.noReach": (type) => `Could not reach the game (${type}).`,
    "err.noAnswer": "The host did not answer.",
    "err.nearbyRefused": (why) => `Gopher Connect said no: ${why}`,
    "err.nearbyGone": "Gopher Connect stopped. Open the app and try again.",
    "err.nearbyNoHost": (code) =>
      `No phone nearby with code ${codeWords(code)}. Check the code, that Bluetooth is on, and that Gopher Connect is running on both phones.`,
    "err.rtcNoAnswer":
      "The host never answered. Check the code — a few networks simply cannot reach each other.",
    "sym.fox": "fox",
    "sym.duck": "duck",
    "sym.bee": "bee",
    "sym.car": "car",
    "sym.rocket": "rocket",
    "sym.pizza": "pizza",
    "sym.tree": "tree",
    "sym.star": "star",
    "sym.moon": "moon",
    "sym.key": "key",
    "sym.hat": "hat",
    "sym.ball": "ball",
  },
};

/* Paint the markup once, now, so the static words are right before main.js
 * has even started building the arena. */
paintStatic();
