# Trailblazers — Codex concepts

## Stream-owner celebration · backflip

`fox-celebration.blend` previews a brief crouch, tucked backwards somersault,
and landing. `fox-celebration.glb` and `fox-celebration-rider.glb` include both:

- `Run_On_Orb`: the existing 0.8-second looping gait.
- `Stream_Tag_Backflip`: a 1.133-second one-shot celebration, returning to the
  starting running pose. The orb remains stationary and independent.

**Intended trigger:** play the celebration on the owner of a neon stream when
a different rider crashes into that stream. After the one-shot finishes, resume
`Run_On_Orb`. Avoid restarting the celebration if it is already playing. This
is the asset contract; gameplay event wiring is left to the gameplay project.

`fox-backflip-preview.gif` / `.mp4` show the motion, with short review pauses at
the start and end. Those pauses are not part of the exported animation.
`build_fox_backflip.py` reads `fox-running.blend`; `combine_fox_clips.py` copies
the existing run tracks onto matching nodes in the new GLBs. All earlier fox
files remain unchanged. Both clip durations, starting/ending poses, and the
unanimated orb were checked; airborne/tucked poses were visually reviewed.
No playtesting was performed.

## Running fox · orb gait study

`fox-running.blend` and `fox-running.glb` contain the new running study;
`fox-running-rider.glb` is the separate animated rider. The orb geometry remains
the same as `fox-detailed-orb.glb`. Previous detailed cruising and original
lower-detail fox assets are preserved.

`Run_On_Orb` is a 0.8-second loop at 30 fps. Twelve leg bones articulate four
legs, with opposite diagonal pairs alternating. Stance targets sweep along the
orb surface; recovery steps lift clear before coming forward again. Body bounce,
ear/fur motion and the existing six-bone tail provide secondary movement.
`RiderRoot` and `OrbRoot` remain unkeyed and independent for jumps and flips.

`fox-running-preview.png` is the still; `fox-run-preview.gif` and
`fox-run-preview.mp4` show the gait. `build_fox_run.py` reads the detailed cruising
Blender file and writes the new assets and animation frames. The clip duration,
matching endpoints, skin export and independent roots were checked. Rendered
contact/recovery poses were reviewed. This is an authored animation study; no
gameplay integration or playtesting was performed.

## Detailed fox · cruising study

The original `orange-fox.blend` and its GLBs remain untouched as the lower-detail
option. The new assets use the `fox-detailed` prefix:

- `fox-detailed.blend`: editable detailed model, six-bone tail rig, and timeline.
- `fox-detailed.glb`: assembled animated rider and independent orb.
- `fox-detailed-rider.glb` / `fox-detailed-orb.glb`: separate assets.
- `fox-detailed-preview.png`: full-resolution studio still.
- `fox-cruise-preview.gif` / `fox-cruise-preview.mp4`: two-second motion preview.

Added a sculpted muzzle, amber eyes with iris detail, layered cheek/chest/crown
fur, swept tail layers, fine whiskers, cuff stitching, and harness hardware.
The `Cruise_Wind` clip combines body bob, ear flutter, fur-tip motion, and
weighted tail movement in one looping animation. It lasts two seconds.

`PlayerRoot` still moves the whole assembly; `RiderRoot` remains available for
independent jumps and flips. The cruising loop animates `CruiseMotion` and its
secondary controls, leaving `RiderRoot` and `OrbRoot` unkeyed. This version has
an authored wind loop and a tail rig; full-body posing and victory clips remain
future work. Runtime quality selection has not been connected to gameplay.

`build_fox_detailed.py` reads the old fox and writes only the new detailed files.
It renders a still and 24 preview frames. `merge_cruise_clip.py` consolidates
Blender's exported tracks into the single `Cruise_Wind` clip. The GLB hierarchy,
skin presence, duration, and matching loop endpoints were checked; rendered
poses were visually reviewed. No playtesting was performed. Procedural fur
shading remains Blender-only; fur geometry and animation are included in GLB.

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
