/* =============================================================================
 * NEONFOX service worker — offline play, installable, OPT-IN updates.
 * -----------------------------------------------------------------------------
 * UPDATE MODEL
 *   Bump VERSION on every deploy. js/update.js registers with
 *   { updateViaCache: 'none' } and calls reg.update() at launch, so a changed
 *   sw.js is noticed immediately and the new build is precached in the
 *   background. The new worker then WAITS — it does NOT take over. An UPDATE
 *   READY button appears on the menu panel, and only that tap posts
 *   SKIP_WAITING. The button lives inside #menu, which is hidden for the whole
 *   of a match, so a deploy cannot land mid-round and destroy a run.
 *
 *   GET_VERSION lets the menu print the build that is actually serving this
 *   session, rather than whatever string happens to be baked into the page.
 *
 * WHY CACHE-FIRST, WHOLE-BUILD
 *   The game is a graph of ES modules with a documented cross-module contract
 *   (see ARCHITECTURE.md). Serving js/render/rider.js from a new deploy beside
 *   js/config.js from an old one would break that contract in ways that are
 *   almost impossible to debug. One versioned cache per deploy means every file
 *   in a session comes from exactly ONE build.
 *
 * WHY THERE ARE TWO CACHES
 *   That argument applies to code. It does not apply to 27 MB of binaries: the
 *   fox model alone is 8.5 MB and vendor/babylon.js 7.5 MB, and re-downloading
 *   those because a CSS colour changed would make every release cost more than
 *   the first install did. So the heavy, immutable files live in their own
 *   cache keyed by MEDIA_VERSION, which changes only when one of THEM changes.
 *   Code is whole-build consistent; a GLB is content addressed by its filename.
 *
 * WHAT IS NOT PRECACHED, AND WHY
 *   ASSETS is the code, the styles, the manifest and the icons — about 200 KB,
 *   so install finishes instantly on every bump. Everything under models/,
 *   audio/ and vendor/ is cached on FIRST FETCH by the handler below instead;
 *   install blocks on every entry of an addAll list, and blocking a version
 *   bump behind 27 MB on whatever connection the player is on is not a trade
 *   worth making. The cost is that the first launch of a session that needs the
 *   fox, the theme or a blocked CDN's fallback pays for it once.
 *
 *   THE HONEST LIMIT THAT COMES WITH THAT: Babylon.js normally loads from
 *   jsDelivr, which is cross-origin and therefore never touched by this worker
 *   (see the fetch handler). vendor/babylon.js is only fetched when the CDN is
 *   blocked, so on a normal install it is never cached here and true offline
 *   play depends on the browser's own HTTP cache of the pinned CDN URL. That is
 *   a real gap and it is written down rather than papered over.
 *
 * THE CACHE PREFIX IS NOT COSMETIC
 *   Every game in the hub shares the ivaruf.github.io origin, so a sloppy
 *   cleanup filter evicts a neighbour's offline install. Both caches here start
 *   with `neonfox-`, the cleanup below matches that prefix and nothing else,
 *   and it must never be widened.
 *
 *   `neonfox` is the SLUG, not the directory. The repo is still called
 *   `trailblazers` from the working name; renaming it is the owner's call, and
 *   when it happens nothing here needs to change — a cache name is a string,
 *   not a path. Every path below is RELATIVE ('./x'), so the game works from
 *   /trailblazers/, from /neonfox/ and from a domain root without edits.
 * ========================================================================== */

// Bump on EVERY deploy — this string is the whole update mechanism. Clients
// that already hold a cache only notice a new build when VERSION changes.
// v1.0.0  THE PWA LAYER. First installable build: manifest, the four generated
//         icons, this worker and js/update.js. No gameplay, no rendering and no
//         module contract was touched — everything here is packaging.
// v1.1.0  PEER TO PEER. js/net/ joins the precache now that main.js loads it:
//         host-authoritative snapshots over WebRTC, signalling in three tiers.
//         vendor/peerjs.js needs no entry here — it matches HEAVY.
const VERSION = 'v1.1.0';

// Bumped only when something under models/, audio/ or vendor/ actually changes.
// Deliberately independent of VERSION: that is the entire point of splitting
// the caches, and moving this in step with VERSION would undo it.
const MEDIA_VERSION = 'm1';

const CACHE = `neonfox-${VERSION}`;
const MEDIA = `neonfox-media-${MEDIA_VERSION}`;

/** Paths that belong in the heavy cache rather than the per-release one. */
const HEAVY = /\/(models|audio|vendor)\//;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  // Keep this list in step with js/ — cache.addAll() is all-or-nothing, so one
  // stale entry for a renamed or deleted module makes install THROW, the old
  // worker keeps serving, and no update ever reaches a player again. It fails
  // silently, which is the worst way for a release to fail.
  //
  './js/audio.js',
  './js/config.js',
  './js/input.js',
  './js/main.js',
  './js/ui.js',
  './js/update.js',
  // Multiplayer. main.js imports these now, so they belong in the precache
  // like everything else it reaches. vendor/peerjs.js is absent on purpose:
  // it matches HEAVY and lives in the media cache.
  './js/net/codes.js',
  './js/net/guest.js',
  './js/net/host.js',
  './js/net/host-worker.js',
  './js/net/lobby.js',
  './js/net/protocol.js',
  './js/net/rendezvous.js',
  './js/net/shadow.js',
  './js/net/webrtc.js',
  './js/render/blue-cat.js',
  './js/render/effects.js',
  './js/render/rider.js',
  './js/render/scene.js',
  './js/render/trails.js',
  './js/sim/ai.js',
  './js/sim/grid.js',
  './js/sim/match.js',
  './js/sim/rng.js',
  './js/sim/world.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  // No skipWaiting() here. After precaching, the new worker stays WAITING until
  // the player accepts it from the menu. This is the whole "respect the
  // session" rule: nothing a deploy does may interrupt a round in progress.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'GET_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION, media: MEDIA_VERSION });
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Ours, and only ours. Widening this prefix would delete a sibling
            // game's offline install on the shared origin.
            .filter((k) => k.startsWith('neonfox-') && k !== CACHE && k !== MEDIA)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Cross-origin is left entirely alone: Babylon and its glTF loader come from
  // jsDelivr pinned with integrity hashes, and the browser's own HTTP cache is
  // better at immutable CDN bytes than we would be.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // A Range request wants a slice. Answering one with a whole cached body is
  // how media playback breaks in ways nobody connects back to the worker, so
  // these go straight to the network.
  if (request.headers.has('range')) return;

  const store = HEAVY.test(url.pathname) ? MEDIA : CACHE;

  // Matched against ONE named cache rather than the whole CacheStorage. A bare
  // caches.match() searches every cache this origin holds — ours from older
  // releases, and every other game in the hub, because the hub is one origin.
  // Naming the store is what keeps the split above meaning something: a module
  // can only ever be answered out of this release's cache.
  event.respondWith(
    caches
      .open(store)
      .then((cache) => cache.match(request, { ignoreSearch: true }))
      .then((hit) => {
        if (hit) return hit;
        return fetch(request)
          .then((res) => {
            if (res.ok && res.type === 'basic') {
              const copy = res.clone();
              caches.open(store).then((c) => c.put(request, copy));
            }
            return res;
          })
          .catch(() =>
            // Offline and uncached. A navigation still gets the shell, which is
            // the difference between the game booting and the browser's
            // dinosaur. The shell only ever lives in the release cache.
            request.mode === 'navigate'
              ? caches.open(CACHE).then((c) => c.match('./index.html'))
              : undefined,
          );
      }),
  );
});
