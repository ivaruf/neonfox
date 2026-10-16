/*
 * nearby.js — playing with no network at all, through Gopher Connect.
 *
 * Gopher Connect is a small Android companion app (its own repo,
 * direct_gopher_connect/, whose DESIGN.md is the contract this file follows).
 * It listens on ws://127.0.0.1:47321/link and carries frames to the other
 * phone over Bluetooth LE. It exists for one situation: two phones in flight
 * mode, where WebRTC cannot work at all — with no network up, Chrome gathers
 * no ICE candidates, so there is nothing for any tier above to negotiate.
 *
 * rendezvous.js tries this only when the broker cannot be reached, so online
 * play never touches it and a player without the app never knows it exists.
 * And only when someone taps Host or Join, never on page load: on the live
 * site, reaching 127.0.0.1 may raise Chrome's "allow access to this device"
 * prompt, which must never appear for a player who only opened the page.
 *
 * The game's own room code does the pairing. The host's page says "listen,
 * neonfox, <code>", the guest's "dial, neonfox, <code>", and the two apps
 * find each other by it. Nobody pairs anything in the app.
 *
 * Every WebSocket message is one frame:
 *
 *   byte 0  kind   1 control (JSON), 2 reliable, 3 fast
 *   byte 1  slot   outgoing: the destination phone; incoming: the source
 *   byte 2  flags  bit 0 when the payload is UTF-8 JSON, else raw bytes
 *   byte 3… payload
 *
 * The host's phone is slot 0 and each guest's phone gets the next number. The
 * channels made here have exactly the shape wrap() in webrtc.js makes —
 * send(value, fast), onMessage, onClose, open, close() — so host.js and
 * guest.js cannot tell this from a data channel, which is the whole point.
 * The lanes keep their meaning: the app never drops a reliable frame, and on
 * the fast lane keeps only the newest pending frame between two phones,
 * which is exactly what maxRetransmits: 0 is for.
 *
 * Honest limits: a host cannot drop one guest from here (the app has no
 * message for it). host.js says REFUSED before it closes a channel, which is
 * what the guest acts on, so that is enough for now.
 */

import { said } from "../i18n.js";

const LINK = "ws://127.0.0.1:47321/link";
const GAME = "neonfox";
const CONTROL = 1;
const RELIABLE = 2;
const FAST = 3;
const TEXT = 1;

// How long to wait for the app's hello before deciding it is not there.
// With no app, the socket fails at once and this never matters. It does
// matter if Chrome is showing its local-network permission prompt, which a
// person may take a while to read; DESIGN.md lists that as an open question.
const HELLO_MS = 4000;
// How long a guest waits for the host's phone to be found and to answer,
// the same patience the broker path has.
const FIND_MS = 20000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function frame(kind, slot, flags, payload) {
  const out = new Uint8Array(3 + payload.length);
  out[0] = kind;
  out[1] = slot;
  out[2] = flags;
  out.set(payload, 3);
  return out;
}

/* Open the socket and wait for the app to say hello; null if it does not. */
function reach() {
  return new Promise((resolve) => {
    let socket;
    try {
      socket = new WebSocket(LINK);
    } catch {
      resolve(null);
      return;
    }
    socket.binaryType = "arraybuffer";
    const give = (value) => {
      clearTimeout(timer);
      socket.onmessage = socket.onerror = socket.onclose = null;
      if (!value)
        try {
          socket.close();
        } catch {
          /* Already gone. */
        }
      resolve(value);
    };
    const timer = setTimeout(() => give(null), HELLO_MS);
    socket.onerror = socket.onclose = () => give(null);
    socket.onmessage = (e) => {
      const m = control(e.data);
      if (m?.t === "hello") give(socket);
    };
  });
}

/* The JSON of a control frame, or null for anything else. */
function control(data) {
  const bytes = new Uint8Array(data);
  if (bytes.length < 3 || bytes[0] !== CONTROL) return null;
  try {
    return JSON.parse(decoder.decode(bytes.subarray(3)));
  } catch {
    return null;
  }
}

function say(socket, message) {
  socket.send(frame(CONTROL, 0, TEXT, encoder.encode(JSON.stringify(message))));
}

/* A channel to one phone over the shared socket, shaped like wrap()'s. */
function channelTo(socket, slot, onGone) {
  let closed = false;
  const channel = {
    get open() {
      return !closed && socket.readyState === WebSocket.OPEN;
    },
    send(value, useFast = false) {
      if (!channel.open) return false;
      const binary = value instanceof Uint8Array;
      const payload = binary ? value : encoder.encode(JSON.stringify(value));
      try {
        socket.send(frame(useFast ? FAST : RELIABLE, slot, binary ? 0 : TEXT, payload));
      } catch {
        return false;
      }
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      onGone?.();
      channel.onClose?.();
    },
    /* A frame for this channel arrived; called by the socket's one reader. */
    deliver(bytes) {
      if (closed) return;
      const payload = bytes.subarray(3);
      if (bytes[2] & TEXT) {
        let value;
        try {
          value = JSON.parse(decoder.decode(payload));
        } catch {
          return;
        }
        channel.onMessage?.(value);
      } else {
        // A copy, so the game may keep it without holding the whole frame.
        channel.onMessage?.(payload.slice());
      }
    },
    onMessage: null,
    onClose: null,
  };
  return channel;
}

/*
 * Host through the app. Resolves once the app is advertising the room, or
 * with null if there is no app to ask — in which case rendezvous.js carries
 * on to the next tier as though this one did not exist.
 */
export async function hostNearby(code, onPeer) {
  const socket = await reach();
  if (!socket) return null;
  const channels = new Map(); // slot -> channel
  return new Promise((resolve, reject) => {
    let listening = false;
    socket.onmessage = (e) => {
      const bytes = new Uint8Array(e.data);
      if (bytes.length < 3) return;
      if (bytes[0] !== CONTROL) {
        channels.get(bytes[1])?.deliver(bytes);
        return;
      }
      const m = control(e.data);
      if (m?.t === "listening" && !listening) {
        listening = true;
        resolve({
          close() {
            socket.onclose = null;
            for (const c of channels.values()) c.close();
            channels.clear();
            try {
              socket.close();
            } catch {
              /* Already gone. */
            }
          },
        });
      } else if (m?.t === "open" && Number.isInteger(m.slot)) {
        const slot = m.slot;
        const channel = channelTo(socket, slot, () => channels.delete(slot));
        channels.set(slot, channel);
        // A string key, like the ids the WebRTC tiers hand host.js.
        onPeer(`nearby-${slot}`, channel);
      } else if (m?.t === "closed") {
        channels.get(m.slot)?.close();
      } else if (m?.t === "refused") {
        if (!listening) reject(said("err.nearbyRefused", String(m.why ?? "")));
      }
    };
    socket.onclose = () => {
      for (const c of [...channels.values()]) c.close();
      channels.clear();
      if (!listening) reject(said("err.nearbyGone"));
    };
    say(socket, { t: "listen", game: GAME, room: code });
  });
}

/*
 * Join through the app. Resolves with the one channel to the host, or null
 * if there is no app; rejects, with a key the lobby can say in either
 * language, if the app is there but the host's phone is not found.
 */
export async function joinNearby(code) {
  const socket = await reach();
  if (!socket) return null;
  return new Promise((resolve, reject) => {
    let channel = null;
    const timer = setTimeout(() => {
      giveUp();
      reject(said("err.nearbyNoHost", code));
    }, FIND_MS);
    const giveUp = () => {
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        /* Already gone. */
      }
    };
    socket.onmessage = (e) => {
      const bytes = new Uint8Array(e.data);
      if (bytes.length < 3) return;
      if (bytes[0] !== CONTROL) {
        if (bytes[1] === 0) channel?.deliver(bytes);
        return;
      }
      const m = control(e.data);
      if (m?.t === "open" && m.slot === 0 && !channel) {
        clearTimeout(timer);
        // One channel is this guest's whole connection, so closing it is
        // leaving: the socket goes, and the app tells the host's phone.
        channel = channelTo(socket, 0, giveUp);
        resolve({ channel, close: () => channel.close() });
      } else if (m?.t === "closed") {
        channel?.close();
      } else if (m?.t === "refused") {
        clearTimeout(timer);
        giveUp();
        reject(said("err.nearbyRefused", String(m.why ?? "")));
      }
    };
    socket.onclose = () => {
      clearTimeout(timer);
      if (channel) channel.close();
      else reject(said("err.nearbyGone"));
    };
    say(socket, { t: "dial", game: GAME, room: code });
  });
}
