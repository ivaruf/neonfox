#!/usr/bin/env python3
# =============================================================================
# NEONFOX — tools/make-icons.py
# -----------------------------------------------------------------------------
# ASSET GENERATOR. NOT PART OF THE GAME AND NOT PART OF ANY BUILD STEP.
#
# The game is ES modules, Babylon.js and nothing else: it never runs Python and
# never imports anything this file touches. This script exists only to
# regenerate the four PNGs in ../icons/ offline, on a developer machine, so that
# the art lives in version control as CODE rather than as four opaque binaries
# nobody can edit.
#
#   python3 tools/make-icons.py            # writes ../icons/*.png
#
# Requires Pillow (developed against 11.3). Nothing else — no network, no fonts.
# If Pillow is missing, do NOT add it to the game: install it locally, or leave
# the icons alone.
#
# -----------------------------------------------------------------------------
# THE MARK — "the fox at the head of its own trail"
#
# NeonFox is Achtung, die Kurve with foxes riding glowing orbs. Two things have
# to be in the icon or it is some other game: THE FOX, and THE TRAIL IT CANNOT
# CROSS. So the mark is one moment from a round:
#
#   * a CYAN TRAIL comes in from the bottom-left corner, sweeps along the floor,
#     curls up the right side and hooks back — the classic Kurve comma, a rider
#     that has been turning one way too long. Its newest end runs under the orb,
#     because the rider is standing on the head of its own trail.
#   * THE GAP. The trail breaks for two trail-widths partway along, which is the
#     one mechanic the shape can carry by itself: a wall with a door in it.
#     Kurve's gap is why you steer INTO a trail instead of away from it.
#   * A SECOND, MAGENTA TRAIL lies across the back of the floor, dimmer and
#     thinner because it is further away. One rival is enough to say that this
#     is a game about other people's walls; two would be clutter at 48 px.
#   * THE FOX rides the orb at the head of the cyan trail — pointed snout, two
#     hard ears, one enormous tail. It is the only WARM thing in the frame and
#     the only thing with a silhouette, so it survives every downscale.
#   * THE FAR RIM. A cyan light strip across the upper third is the arena wall,
#     the other thing that kills you. It bleeds off both sides at every scale,
#     deliberately: a rim with visible corners would be cropped into a mistake
#     by the maskable variant.
#
# COLOUR IS THE GAME'S OWN. --ground #0a1030, --rim #46e6ff and the Mochi rider
# #ff5fb4 come straight out of css/style.css; the background's darkest stop is
# the navy the manifest declares as background_color, so an installed PWA fades
# from its splash into the arena with no seam. The fox wears Tango #ffa03c, a
# real rider colour from js/config.js PALETTE.
#
# LEGIBILITY RULES THIS ART OBEYS
#   * no text anywhere, nothing load-bearing thinner than ~8 design units
#   * one dominant silhouette (fox + orb) reading at 48 px against a dark field
#   * the gap, the rival trail and the eye are TEXTURE: they may vanish when
#     shrunk, and do, and the mark still reads as a fox on a neon curve
#
# HOW IT IS DRAWN
#   Everything is composited at SS x the 512 design canvas and downsampled with
#   LANCZOS, so every edge is antialiased without a single ImageDraw AA hack.
#   All geometry is in 512-unit DESIGN COORDINATES (+y is DOWN, as on a canvas)
#   and pushed through `View`, which scales about the centre. That is what makes
#   the maskable variant a one-line change: the same drawing at MASK_SCALE, full
#   bleed, no rounded corners, everything that matters inside the 80% circle.
#
#   Neon is drawn the way neon works: a wide blurred pass ADDED to the frame,
#   then a narrower brighter one, then a near-white core. Alpha-compositing a
#   glow over navy greys it; adding it makes the navy light up.
# =============================================================================

import math
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

# -----------------------------------------------------------------------------
# Output
# -----------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
ICON_DIR = os.path.join(os.path.dirname(HERE), 'icons')

DESIGN = 512      # every coordinate below is in this space
SS = 4            # supersample factor; 512 * 4 = 2048 px working canvas

# The two scales the whole mark is ever drawn at. The composition is authored
# with room around it so the plain icon can push PAST the design frame — at 1.12
# the fox fills the plate properly and the trails run off the edges, which is
# what an arena that continues past the icon should do. The maskable one keeps
# the same ratio to the design frame (0.88 / 1.12 == 0.78), which is what puts
# everything load-bearing inside the 80% safe circle.
PLAIN_SCALE = 1.12
MASK_SCALE = 0.88

# =============================================================================
# Palette — all of it lifted from css/style.css and js/config.js
# =============================================================================
BG_TOP = '#101a4e'     # the arena's far wall catching its own rim light
BG_MID = '#0a1030'     # == --ground == manifest background_color
BG_BOT = '#05081c'     # the floor falling away at the player's feet

RIM = '#46e6ff'        # --rim. The wall strip, the ridden trail, the orb.
MOCHI = '#ff5fb4'      # PALETTE[1] "Mochi". The rival trail.

# The fox is PALETTE[3] "Tango" exactly, not an orange chosen to look like it.
# Every colour in this file is one the game already draws with, which is what
# makes the icon and the arena feel like the same thing rather than a mark
# designed alongside a game.
FUR = '#ffa03c'
FUR_DARK = '#d9661a'   # haunch, far leg, underside of the tail
CREAM = '#ffe8d2'      # muzzle, chest, tail tip
INK = '#0a1130'        # every outline. Near --ground, so shapes sit IN the dark.

# =============================================================================
# Geometry — design coordinates (0..512, +y is DOWN)
# =============================================================================

# The arena's far wall. Spans the OVERSCAN width so it bleeds off both edges at
# every scale — see the header on why a visible corner would be a bug.
RIM_Y = 150
RIM_THICKNESS = 9

# The orb the fox rides, and therefore where the trail has to end.
ORB = (302, 344, 56)   # cx, cy, r

# The ridden trail: Catmull-Rom through these, oldest first. The last anchor is
# INSIDE the orb on purpose — the orb is drawn over it, so the trail's newest
# end disappears under the rider instead of stopping in mid-air.
TRAIL = [
    (16, 386),
    (92, 462),
    (226, 494),
    (352, 470),
    (424, 402),
    (394, 344),
    (312, 368),
]
# Where the gap falls is not a free choice. The plain icon is drawn at
# PLAIN_SCALE, which pushes the trail's lowest sweep off the bottom edge, so a
# gap in the middle of the path (0.46-0.55, the first try) existed only in the
# maskable variant. This span sits on the right-hand curl, which is well inside
# the frame at both scales.
TRAIL_GAP = (0.615, 0.685)  # normalised span of the trail that is not painted
TRAIL_W = 21                # painted width, ~1/24 of the arena, as in the game

# The rival, further back and therefore thinner. It stops short of the fox: a
# trail running behind the rider would fight the one silhouette that matters.
RIVAL = [
    (-52, 302),
    (48, 268),
    (146, 252),
    (232, 270),
]
RIVAL_GAP = (0.52, 0.63)
RIVAL_W = 13

# --- The fox. Absolute design coordinates, facing right, standing on the orb.
#     Paw contact points are ON the orb's surface (checked against ORB), so it
#     rides the ball rather than hovering over it.
TAIL = [                      # spine of the plume, root first
    (256, 248),
    (218, 228),
    (190, 202),
    (168, 170),
]
# Half-widths at each spine point: fat at the root, a point at the tip. Wider
# than this and the plume stops reading as a tail and starts reading as a
# raised arm — which the first pass did, at 34.
TAIL_W = (26, 24, 18, 8)
BODY = (288, 250, 53, 30, -13)     # cx, cy, rx, ry, rotation in degrees
HAUNCH = (256, 252, 31, 28, 0)
HEAD = (345, 226, 30, 24, -8)
SNOUT = [(346, 214), (396, 231), (346, 246)]
EAR_BACK = [(325, 214), (327, 168), (354, 205)]
EAR_FRONT = [(350, 208), (368, 172), (380, 215)]
CHEST = (333, 254, 16, 20, 0)
LEG_FRONT = ((332, 250), (330, 295), 11)   # top, paw, half-width
LEG_BACK = ((268, 258), (266, 300), 12)
EYE = (349, 219)


# =============================================================================
# Small helpers
# =============================================================================
def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


class View:
    """Design coordinates -> canvas pixels, scaled about the centre.

    Scale is the ONLY difference between the plain icon and the maskable one:
    at 0.78 the whole composition retreats inside the 80% safe circle while the
    background and the wall strip keep bleeding to the edges.
    """

    def __init__(self, scale, px):
        self.s = scale * (px / float(DESIGN))
        self.c = px / 2.0
        self.px = px

    def p(self, x, y):
        return (self.c + (x - DESIGN / 2.0) * self.s,
                self.c + (y - DESIGN / 2.0) * self.s)

    def n(self, v):
        """A length."""
        return max(1.0, v * self.s)

    def box(self, b):
        x0, y0 = self.p(b[0], b[1])
        x1, y1 = self.p(b[2], b[3])
        return [x0, y0, x1, y1]

    def poly(self, pts):
        return [self.p(x, y) for x, y in pts]

    def inv_y(self, cy):
        """Canvas row -> design y. Used to build gradients in design space."""
        return DESIGN / 2.0 + (cy - self.c) / self.s


def ramp(view, size, stops):
    """A full-canvas vertical RGBA gradient whose stops are DESIGN y values.

    Built one pixel column tall and stretched, which is both exact and instant —
    a per-pixel loop over a 2048 square canvas is not.
    """
    w, h = size
    strip = Image.new('RGBA', (1, h))
    px = strip.load()
    for cy in range(h):
        px[0, cy] = _sample(stops, view.inv_y(cy + 0.5))
    return strip.resize((w, h), Image.NEAREST)


def _sample(stops, y):
    if y <= stops[0][0]:
        return stops[0][1]
    if y >= stops[-1][0]:
        return stops[-1][1]
    for i in range(len(stops) - 1):
        y0, c0 = stops[i]
        y1, c1 = stops[i + 1]
        if y0 <= y <= y1:
            t = 0.0 if y1 == y0 else (y - y0) / float(y1 - y0)
            return tuple(int(round(c0[k] + (c1[k] - c0[k]) * t)) for k in range(4))
    return stops[-1][1]


def masked(paint, mask):
    """Multiply an RGBA layer's alpha by an L mask."""
    out = paint.copy()
    out.putalpha(ImageChops.multiply(out.getchannel('A'), mask))
    return out


def add_light(base, layer):
    """Composite `layer` ADDITIVELY onto an opaque base.

    Neon is light, and light adds. Alpha-compositing a cyan glow over navy just
    greys the navy out; adding it makes the navy glow, which is the whole mark.
    `base` is always fully opaque here — the rounded-corner alpha is applied
    once, at the very end.
    """
    a = layer.getchannel('A')
    prem = Image.merge('RGB', [
        ImageChops.multiply(layer.getchannel(c), a) for c in ('R', 'G', 'B')
    ])
    return ImageChops.add(base.convert('RGB'), prem).convert('RGBA')


def oval(cx, cy, rx, ry, rot=0.0, n=64):
    """An ellipse as a polygon, so it can be rotated. Pillow's own ellipse()
    is axis-aligned, and a fox built from axis-aligned ovals looks like a
    diagram of a fox."""
    a = math.radians(rot)
    ca, sa = math.cos(a), math.sin(a)
    pts = []
    for i in range(n):
        t = math.tau * i / n
        x, y = rx * math.cos(t), ry * math.sin(t)
        pts.append((cx + x * ca - y * sa, cy + x * sa + y * ca))
    return pts


def catmull(anchors, samples=220):
    """A smooth polyline through every anchor. Centripetal-ish Catmull-Rom with
    the ends duplicated, which is all a hand-placed curve needs."""
    p = [anchors[0]] + list(anchors) + [anchors[-1]]
    out = []
    for i in range(len(p) - 3):
        p0, p1, p2, p3 = p[i], p[i + 1], p[i + 2], p[i + 3]
        for k in range(samples // (len(p) - 3)):
            t = k / float(samples // (len(p) - 3))
            t2, t3 = t * t, t * t * t
            out.append((
                0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t
                       + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                       + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t
                       + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                       + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
            ))
    out.append(anchors[-1])
    return out


def split_gap(points, gap):
    """Cut a normalised span out of a polyline — the trail's gap. Returns the
    two runs that are still painted; either may be empty at the extremes."""
    n = len(points)
    a, b = int(n * gap[0]), int(n * gap[1])
    return [r for r in (points[:a], points[b:]) if len(r) > 1]


def tapered(spine, widths):
    """A closed polygon around a spine, `widths` giving the half-width at each
    spine point. Used for the tail and the legs — anything that has to be fat
    at one end and a point at the other."""
    left, right = [], []
    for i, (x, y) in enumerate(spine):
        px, py = spine[max(0, i - 1)]
        nx, ny = spine[min(len(spine) - 1, i + 1)]
        dx, dy = nx - px, ny - py
        d = math.hypot(dx, dy) or 1.0
        ox, oy = -dy / d * widths[i], dx / d * widths[i]
        left.append((x + ox, y + oy))
        right.append((x - ox, y - oy))
    return left + right[::-1]


# =============================================================================
# The drawing passes
# =============================================================================
def draw_trail(layer, view, runs, width, color, alpha=255):
    """One rider's painted wall: a dark edge, the rider's colour, a near-white
    core — three lines down the SAME path, narrowing.

    The first attempt drew the two outer passes OFFSET vertically, to suggest
    that a trail in this game is 0.34 units tall rather than flat. Offsetting a
    curve does not offset evenly: where the path bends hard the offset copy
    bunches on the inside and spreads on the outside, and the ribbon came out
    striped like a barcode. Concentric widths are both simpler and how a neon
    tube actually looks.

    The caps are deliberately blunt. That is what a Kurve GAP is — paint that
    stops, not paint that fades."""
    d = ImageDraw.Draw(layer, 'RGBA')
    edge = mix(color, rgb(INK), 0.55)
    hot = mix(color, (255, 255, 255), 0.62)
    for run in runs:
        pts = view.poly(run)
        for fill, w in ((edge, width), (color, width * 0.72), (hot, width * 0.30)):
            d.line(pts, fill=fill + (alpha,), width=int(view.n(w)), joint='curve')


def draw_fox(img, view):
    """The rider. Flat colour with a heavy ink outline — a silhouette-first
    illustration, because everything around it is glow and glow has no edges."""
    d = ImageDraw.Draw(img, 'RGBA')
    ink = rgb(INK) + (255,)
    w = int(view.n(7))

    def shape(pts, fill, outline=True):
        d.polygon(view.poly(pts), fill=rgb(fill) + (255,),
                  outline=ink if outline else None, width=w)

    # Back to front: tail, far leg, haunch, body, near leg, chest, head.
    spine = catmull(TAIL, 60)
    widths = _spread(TAIL_W, len(spine))
    shape(tapered(spine, widths), FUR_DARK)
    # The last third of the plume is the cream tip. Drawn as its own tapered
    # slice of the SAME spine, so the tip can never drift off the tail.
    cut = int(len(spine) * 0.74)
    tip = tapered(spine[cut:], [w * 0.84 for w in widths[cut:]])
    d.polygon(view.poly(tip), fill=rgb(CREAM) + (255,))

    shape(_leg(LEG_BACK), FUR_DARK)
    shape(oval(*HAUNCH), FUR_DARK)
    shape(oval(*BODY), FUR)
    shape(_leg(LEG_FRONT), FUR)
    shape(oval(*CHEST), CREAM)
    # Cream socks where the paws meet the orb. Two bright dots on the ball are
    # what make the fox read as RUNNING on it rather than perched on top.
    for (_, (px_, py_), hw) in (LEG_BACK, LEG_FRONT):
        d.ellipse(view.box((px_ - hw * 0.9, py_ - hw * 0.62,
                            px_ + hw * 0.9, py_ + hw * 0.62)),
                  fill=rgb(CREAM) + (255,), outline=ink, width=int(view.n(5)))
    shape(oval(*HEAD), FUR)
    shape(EAR_BACK, FUR_DARK)
    shape(EAR_FRONT, FUR)
    shape(SNOUT, CREAM)

    # The eye. Ink, with a cyan catchlight: the fox is lit by its own trail.
    ex, ey = EYE
    d.ellipse(view.box((ex - 7, ey - 8, ex + 7, ey + 8)), fill=ink)
    d.ellipse(view.box((ex - 2, ey - 6, ex + 4, ey - 1)), fill=rgb(RIM) + (255,))


def _spread(widths, n):
    """Four authored half-widths stretched over n spine samples."""
    out = []
    for i in range(n):
        t = i / float(n - 1) * (len(widths) - 1)
        lo = min(int(t), len(widths) - 2)
        f = t - lo
        out.append(widths[lo] + (widths[lo + 1] - widths[lo]) * f)
    return out


def _leg(leg):
    (x0, y0), (x1, y1), hw = leg
    return tapered([(x0, y0), (x1, y1)], [hw, hw * 0.78])


def draw_orb(img, view):
    """The glowing ball the fox runs on. Rim-lit rather than shaded: it is a
    light source in the game and the trail behind it is the same colour."""
    d = ImageDraw.Draw(img, 'RGBA')
    cx, cy, r = ORB
    d.ellipse(view.box((cx - r, cy - r, cx + r, cy + r)),
              fill=rgb('#14235e') + (255,), outline=rgb(INK) + (255,),
              width=int(view.n(7)))
    d.ellipse(view.box((cx - r * 0.82, cy - r * 0.82, cx + r * 0.82, cy + r * 0.82)),
              outline=rgb(RIM) + (255,), width=int(view.n(8)))
    # The hot centre, pulled up and left so the ball has a direction of light.
    d.ellipse(view.box((cx - r * 0.42, cy - r * 0.52, cx + r * 0.30, cy + r * 0.20)),
              fill=mix(rgb(RIM), (255, 255, 255), 0.45) + (255,))


def glow(view, size, draw, blurs):
    """Draw something once, then ADD it back several times at widening blurs.
    `draw` takes an ImageDraw-ready RGBA layer. Returns a list of layers."""
    base = Image.new('RGBA', size, (0, 0, 0, 0))
    draw(base)
    return [base.filter(ImageFilter.GaussianBlur(view.n(b))) if b else base
            for b in blurs]


# =============================================================================
# Compose
# =============================================================================
def render(scale=1.0, px=DESIGN * SS):
    view = View(scale, px)
    size = (px, px)

    # 1. The arena: far wall above the rim, floor below it, falling to the navy
    #    the manifest calls background_color.
    img = ramp(view, size, [
        (-140, rgb(BG_TOP) + (255,)),
        (RIM_Y - 6, rgb('#0d1540') + (255,)),
        (RIM_Y + 8, rgb(BG_MID) + (255,)),
        (420, rgb('#080d24') + (255,)),
        (700, rgb(BG_BOT) + (255,)),
    ])

    # 2. The wall's light strip, bleeding off both edges. Three passes: a wide
    #    haze in the air, a tighter bloom, then the strip itself.
    def wall(layer):
        ImageDraw.Draw(layer, 'RGBA').rectangle(
            view.box((-400, RIM_Y, 912, RIM_Y + RIM_THICKNESS)),
            fill=rgb(RIM) + (255,))
    haze, bloom, strip = glow(view, size, wall, (40, 11, 0))
    img = add_light(img, _fade(haze, 0.30))
    img = add_light(img, _fade(bloom, 0.42))
    img = add_light(img, _fade(strip, 0.85))

    # 3. The rival trail, first and dimmest: it is behind everything.
    rival = split_gap(catmull(RIVAL), RIVAL_GAP)

    def paint_rival(layer):
        draw_trail(layer, view, rival, RIVAL_W, rgb(MOCHI), alpha=210)
    r_glow, r_core = glow(view, size, paint_rival, (16, 0))
    img = add_light(img, _fade(r_glow, 0.40))
    img = Image.alpha_composite(img, _fade(r_core, 0.80))
    img = add_light(img, _fade(r_core, 0.22))

    # 4. The ridden trail. Same three-pass neon, brighter, and it is the shape
    #    that carries the icon — the eye is meant to run along it to the fox.
    ridden = split_gap(catmull(TRAIL), TRAIL_GAP)

    def paint_trail(layer):
        draw_trail(layer, view, ridden, TRAIL_W, rgb(RIM))
    t_wide, t_tight, t_core = glow(view, size, paint_trail, (26, 8, 0))
    img = add_light(img, _fade(t_wide, 0.34))
    img = add_light(img, _fade(t_tight, 0.34))
    img = Image.alpha_composite(img, t_core)
    img = add_light(img, _fade(t_core, 0.30))

    # 5. The orb's pool of light on the floor, under everything it stands on.
    pool = Image.new('RGBA', size, (0, 0, 0, 0))
    cx, cy, r = ORB
    ImageDraw.Draw(pool, 'RGBA').ellipse(
        view.box((cx - r * 2.2, cy + r * 0.10, cx + r * 2.2, cy + r * 1.15)),
        fill=rgb(RIM) + (120,))
    img = add_light(img, pool.filter(ImageFilter.GaussianBlur(view.n(24))))

    # 6. A cyan halo behind the fox and orb, so the warm silhouette sits in its
    #    own light instead of being pasted onto the floor.
    rider = Image.new('RGBA', size, (0, 0, 0, 0))
    draw_orb(rider, view)
    draw_fox(rider, view)
    halo = rider.copy()
    halo.paste((*rgb(RIM), 255), (0, 0), rider.getchannel('A'))
    img = add_light(img, _fade(halo.filter(ImageFilter.GaussianBlur(view.n(17))), 0.34))

    # 7. The rider itself, over everything. Nothing occludes the fox.
    img = Image.alpha_composite(img, rider)

    # 8. The orb's own bloom, last, so it spills over the fox's paws and outline.
    bloom = Image.new('RGBA', size, (0, 0, 0, 0))
    ImageDraw.Draw(bloom, 'RGBA').ellipse(
        view.box((cx - r * 0.9, cy - r * 0.9, cx + r * 0.9, cy + r * 0.9)),
        fill=rgb(RIM) + (150,))
    img = add_light(img, bloom.filter(ImageFilter.GaussianBlur(view.n(20))))

    # 9. Vignette. Holds the corners down so the trail's bright sweep is the
    #    only thing competing with the fox at 48 px.
    vig = Image.new('L', size, 0)
    ImageDraw.Draw(vig).ellipse([-px * 0.20, -px * 0.26, px * 1.20, px * 1.26], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(px * 0.10))
    dark = Image.new('RGBA', size, (2, 4, 16, 150))
    img = Image.alpha_composite(img, masked(dark, ImageChops.invert(vig)))

    return img


def _fade(layer, k):
    """Scale a layer's alpha. Every glow pass is tuned by one of these."""
    out = layer.copy()
    out.putalpha(out.getchannel('A').point(lambda v: int(v * k)))
    return out


def rounded(img, radius_design=112):
    """Transparent corners, matching the plate shape the hub's other icons use."""
    px = img.size[0]
    m = Image.new('L', img.size, 0)
    r = radius_design * px / float(DESIGN)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, px - 1, px - 1], radius=r, fill=255)
    out = img.copy()
    out.putalpha(m)
    return out


def down(img, size):
    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(ICON_DIR, exist_ok=True)

    # Plain icons: rounded plate, transparent corners, art at full scale. The
    # 180 is iOS's apple-touch-icon, which is NOT optional — pointing iOS at the
    # 192 is what supermine does and the hub's rules call it out as a mistake.
    plate = rounded(render(scale=PLAIN_SCALE))
    for size in (512, 192, 180):
        path = os.path.join(ICON_DIR, 'icon-%d.png' % size)
        down(plate, size).save(path)
        print('wrote', path)

    # Maskable: full bleed to all four edges, art at MASK_SCALE. Measured from
    # the centre at that scale, the fox's ear tip lands 123 canvas units out, the
    # tail tip 108, the orb's lowest edge 133 and the trail's far right 196,
    # against a safe-zone radius of 205 — the whole rider and the hook of trail
    # it stands on survive the most aggressive circular crop. The only thing
    # that does not is the trail's lowest sweep, at 211, which loses a few
    # pixels off an arc already running into the vignette.
    mask_img = render(scale=MASK_SCALE).convert('RGB').convert('RGBA')
    path = os.path.join(ICON_DIR, 'icon-maskable-512.png')
    down(mask_img, 512).save(path)
    print('wrote', path)


if __name__ == '__main__':
    main()
