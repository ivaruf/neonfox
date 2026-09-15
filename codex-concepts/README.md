# Trailblazers — Codex concepts

## Companion animals

**Dog addition:** `green-dog.blend` contains a warm tan puppy with chocolate
floppy ears, a rounded cream muzzle, a little tongue, and a raised tail on a
green orb. `green-dog.glb` is assembled; `green-dog-rider.glb` and
`green-dog-orb.glb` are separate exports with the same independent roots.
`green-dog-preview.png` is its still render. Rebuild using `build_dog.py`, which
reads `blue-cat-v3.blend`. No rig or animation is added, and no playtesting is done.

Three new species using the approved v3 cat's style and independent roots:

| File stem | Animal | Distinct features |
| --- | --- | --- |
| `orange-fox` | Orange fox | Longer cream muzzle, cheek ruff, bushy cream-tipped tail |
| `pink-bunny` | Pink bunny | Tall rounded ears, tiny incisors, cotton tail |
| `purple-bear` | Purple bear cub | Round ears, oval muzzle, button nose |

Each stem has an editable `.blend`, an assembled `.glb`, a `-rider.glb`, and an
`-orb.glb`. All preserve `PlayerRoot` with independent `RiderRoot` and `OrbRoot`
children, just like cat v3. No animation clips or skeletal rigs are included.

`animal-lineup.blend` is the presentation scene; `animal-lineup-preview.png` is
its review render. `build_animals.py` derives these models from `blue-cat-v3.blend`
and rebuilds all companion outputs. The cat's source files are not modified.
The GLB root hierarchies were checked; no playtesting was performed.

## 03 · Cuter face and independent rider/orb (current)

`blue-cat-v3.blend` contains the editable scene. `blue-cat-v3.glb` contains the
assembled character and orb. Separate exports: `cat-rider-v3.glb` and `orb-v3.glb`.
`blue-cat-v3-preview.png` is the reviewed still. Rebuild with
`Blender --background --python build_blender_v3.py`.

The face has fuller cheeks, larger rounded eyes and pupils, shorter ears and
whiskers, and softer paws. Previous versions remain available.

The Blender scene and assembled GLB use this hierarchy:

```
PlayerRoot
  RiderRoot  (all cat geometry, including cuffs and harness)
  OrbRoot    (sphere and energy rings)
```

Move `PlayerRoot` for normal travel. Translate `RiderRoot` for a hop and rotate
it for a whole-body flip, leaving `OrbRoot` stationary. RiderRoot's pivot sits
near the torso center at Blender coordinates `(0, -0.04, 1.90)`; OrbRoot is at
the sphere center `(0, 0, 0.78)`. Parenting preserves the riding pose. Separate
exports retain these authored offsets; they are not recentered to the origin.

The hierarchy was checked in the exported GLBs. No victory animation or skeletal
rig is included yet: these roots support rigid whole-character motion; bending
legs or posing the spine would require a rig. No playtesting was performed.
The browser viewer still shows version 01. Procedural fur bump remains Blender-only.

## 02 · More feline proportions

`blue-cat-v2.blend` is the revised native model; `blue-cat-v2.glb` exports the
character and orb. `blue-cat-v2-preview.png` shows the revised studio render.
Rebuild with `Blender --background --python build_blender_v2.py`.

Changes: smaller sculpted head, almond jade eyes with slit pupils, cupped ears,
triangular nose, compact muzzle, whiskers, joined body surfaces, shaped paws,
and a tapered tail. The blue is muted, with rougher fur shading and subtle tabby
accents. This remains a stylized concept, without a groom or animation rig.
Procedural fur bump is native to Blender and is not baked into the GLB.
The still was visually reviewed; no playtesting was performed.

Version 01 is retained below; the browser viewer still shows that original.

## 01 · Blue cat orb rider

One procedural 3D character study inspired by the supplied reference: oversized
head, pointed ears, cream cheeks, curled tail, dark riding suit, cyan cuffs and
a luminous orb. The crouched pose places the paws over the orb's leading edge.

Open `blue-cat.blend` in Blender to edit the model. `blue-cat.glb` is an asset-only
export, and `blue-cat-preview.png` is the first studio render. The Blender file
keeps the character collection separate from the camera, lights, and plinth.
Rebuild with `Blender --background --python build_blender.py` (overwrites outputs).

The initial procedural browser version is also available: open `index.html`.
Internet is needed for Babylon.js from its CDN.
Drag to orbit, scroll to zoom, or use **From above** to inspect the silhouette.
No gameplay or playtesting is included.

`blue-cat.js` contains the reusable `createBlueCat(scene)` factory. Load it after
Babylon.js; it returns `{ root, materials }`. All character meshes are children
of `root`, allowing the entire model to be moved, rotated, or scaled together.
The character faces -Z, with Y up. The orb's center is at Y = 0.78 and diameter
is 1.44. The Blender builder maps browser Y-up coordinates to Blender Z-up.
Geometry and materials are generated in code; there are no textures, rigging,
or animations in this initial study. These are concept meshes, not optimized
production assets.

This directory is independent of the gameplay implementation. The Blender still
has been rendered and visually reviewed; the browser viewer has not been tested.
No playtesting was performed. Pause here for art direction before adding further
characters or detail.
