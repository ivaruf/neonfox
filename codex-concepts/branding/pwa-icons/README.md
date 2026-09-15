# Neon Fox · PWA icon pack

A text-free fox mascot derived from the Neon Fox title logo. Orange and cream
fur, amber eyes, cyan rim light, and a neon orbit on an opaque navy background.

## Files

- `neon-fox-192.png`, `neon-fox-512.png`: standard manifest icons.
- `neon-fox-maskable-192.png`, `neon-fox-maskable-512.png`: padded maskable icons.
- `apple-touch-icon.png`: 180 × 180 icon for the Apple touch-icon link.
- `favicon-32.png`, `favicon-16.png`: small browser icons.
- `neon-fox-1024.png`, `neon-fox-maskable-1024.png`: larger exports.
- `neon-fox-icon-master.png`: original generated artwork.
- `manifest-icons.json`: fields to merge into the game's existing manifest.
- `head-links.html`: optional HTML links for touch icons and favicons.

Copy the production PNGs to `/icons/`, or adjust the supplied URLs to the game's
deployment path. Merge the JSON fields into the existing manifest, retaining
its start URL, scope, display settings, and other app configuration. This folder
does not change the gameplay project or configure PWA installation by itself.

Maskable artwork receives additional padding, with an opaque full-bleed
background and square corners. The operating system applies its own mask.
The platform's guaranteed safe area is a centered circle with radius 40% of the
icon width; see [web.dev maskable icon guidance](https://web.dev/articles/maskable-icon).
The manifest sizes follow [web.dev's manifest guidance](https://web.dev/learn/pwa/web-app-manifest).

Created with the built-in image-generation tool using the existing logo as a
reference. Standard PNG resizing and maskable padding were exported with macOS
`sips`. See `generation-prompt.md` for the exact design prompt. PNG sizes and
opacity were checked; launcher installation was not tested.
