# Where these came from

Codex drew the fox. The artwork and the prompt that produced it are in
`../codex-concepts/branding/pwa-icons/`, which is the source these PNGs were
exported from, along with `neon-fox-icon-master.png` at full size and the
1024 exports. `../art/logo.webp` is the title logo from
`../codex-concepts/branding/neon-fox-logo-v1.png`, trimmed to its own glow
and resized to 880 wide.

This replaces a procedural `tools/make-icons.py`, which drew the mark in
Pillow and was the source of truth until 2026-09-15. Hub CLAUDE.md §4 asks
for that script and says the script, not the PNGs, is the truth. That rule
assumes the icon is something a script can draw. This one is not, so the
prompt and the master file are the truth instead, and the script is gone
rather than left behind to generate icons nobody ships. Worth raising at hub
level rather than quietly diverging in one game.

| file | purpose |
| --- | --- |
| `icon-192.png`, `icon-512.png` | manifest, `purpose: any` |
| `icon-maskable-192.png`, `icon-maskable-512.png` | manifest, `purpose: maskable`, opaque full bleed with the safe area inset |
| `icon-180.png` | `apple-touch-icon`, a real 180 rather than iOS pointed at the 192 |
| `favicon-32.png`, `favicon-16.png` | the browser tab |
