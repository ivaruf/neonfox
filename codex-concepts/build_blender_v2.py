"""Run: Blender --background --python build_blender.py"""
import bpy, math
from pathlib import Path
from mathutils import Vector
OUT = Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def mat(name, color, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = .38
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    return m
blue = mat('Cobalt fur', (.025,.24,.7))
cream = mat('Ice cream fur', (.74,.88,1))
pink = mat('Pink ears and nose', (.9,.23,.42))
dark = mat('Midnight riding suit', (.012,.024,.055))
cyan = mat('Cyan accents', (.025,.72,1), .8)
black = mat('Pupils', (.002,.004,.01))
orb = mat('Azure orb', (.006,.18,.34), .7)
energy = mat('Energy rings', (.08,.8,1), 5)
# Match the browser model coordinates: forward -Z becomes Blender -Y, up Y becomes Z.
def xyz(p): return (p[0], p[2], p[1])
def ball(name, p, scale, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, radius=.5, location=xyz(p))
    o = bpy.context.object; o.name = name; o.scale = xyz(scale)
    o.data.materials.append(material)
    for f in o.data.polygons: f.use_smooth = True
    return o

def tube(name, pts, radius, material):
    c = bpy.data.curves.new(name, 'CURVE'); c.dimensions = '3D'
    c.bevel_depth = radius; c.bevel_resolution = 3
    s = c.splines.new('BEZIER'); s.bezier_points.add(len(pts)-1)
    for b, p in zip(s.bezier_points, pts):
        b.co = xyz(p); b.handle_left_type = b.handle_right_type = 'AUTO'
    o = bpy.data.objects.new(name, c); bpy.context.collection.objects.link(o)
    c.materials.append(material)
    return o

ball('Gliding orb', (0,.78,0), (1.44,1.44,1.44), orb)
for i in range(3):
    bpy.ops.mesh.primitive_torus_add(major_radius=.74, minor_radius=.013,
        major_segments=64, minor_segments=8, location=(0,0,.78))
    o = bpy.context.object; o.name = 'Orb energy ring'
    o.rotation_euler = (.35+i*.68, i*.72, 0); o.data.materials.append(energy)
# Revision 02: continuous anatomy, cupped ears and inset feline eyes.
fur = mat('Slate blue short fur', (.045,.16,.29))
lightfur = mat('Warm ivory muzzle', (.67,.73,.72))
stripe = mat('Tabby markings', (.014,.045,.079))
ear_skin = mat('Muted inner ear', (.28,.105,.12))
nose_mat = mat('Rose leather nose', (.25,.065,.08))
iris = mat('Jade iris', (.10,.48,.23))
rim_mat = mat('Eye rims', (.025,.043,.045))
whisker_mat = mat('Whisker ivory', (.65,.76,.77))
for m in [fur, lightfur, stripe]:
    nodes=m.node_tree.nodes; links=m.node_tree.links
    bs=nodes.get('Principled BSDF'); bs.inputs['Roughness'].default_value=.72
    bs.inputs['Sheen Weight'].default_value=.22
    noise=nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value=180
    bump=nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.18
    bump.inputs['Distance'].default_value=.012
    links.new(noise.outputs['Fac'],bump.inputs['Height']); links.new(bump.outputs['Normal'],bs.inputs['Normal'])

def fuse(name, objects, voxel=.018):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.join(); o=bpy.context.object; o.name=name
    rem=o.modifiers.new('Sculpted union','REMESH'); rem.mode='VOXEL'; rem.voxel_size=voxel
    bpy.ops.object.modifier_apply(modifier=rem.name)
    sm=o.modifiers.new('Surface relax','SMOOTH'); sm.factor=1.1; sm.iterations=6
    bpy.ops.object.modifier_apply(modifier=sm.name)
    sub=o.modifiers.new('Soft sculpt','SUBSURF'); sub.levels=1
    for face in o.data.polygons: face.use_smooth=True
    return o

def tapered(name, pts, radius, material, radii):
    o=tube(name,pts,radius,material)
    for b,r in zip(o.data.splines[0].bezier_points,radii): b.radius=r
    o.data.resolution_u=16
    o.data.use_fill_caps=True
    return o

# A crouching feline spine with shoulders, bent hocks and smaller head.
fuse('Cat torso sculpt',[
    ball('Ribcage',(0,1.63,.13),(.64,.70,.87),fur),
    ball('Shoulders',(0,1.81,-.19),(.64,.53,.55),fur),
    ball('Neck',(0,1.94,-.28),(.48,.49,.47),fur),
    ball('Pelvis',(0,1.54,.43),(.61,.59,.56),fur)])
ball('Chest bib',(0,1.74,-.375),(.36,.43,.11),lightfur)
for side in [-1,1]:
    fuse('Bent rear leg',[
        ball('Thigh',(side*.34,1.43,.38),(.39,.51,.53),fur),
        ball('Hock',(side*.43,1.22,.31),(.23,.36,.26),fur),
        ball('Rear paw',(side*.44,1.15,.08),(.26,.20,.40),lightfur)])
    arm=tapered('Foreleg',[(side*.27,1.83,-.20),(side*.35,1.60,-.38),
        (side*.34,1.40,-.55)],.13,fur,[1.10,.82,.66])
    bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True)
    bpy.context.view_layer.objects.active=arm; bpy.ops.object.convert(target='MESH'); arm=bpy.context.object
    parts=[arm,ball('Paw',(side*.34,1.34,-.61),(.26,.19,.30),lightfur)]
    for toe in [-1,0,1]:
        parts.append(ball('Toe',(side*.34+toe*.070,1.315,-.71),(.10,.13,.14),lightfur))
    fuse('Foreleg and soft paw',parts,.012)
    # Narrow fabric cuffs leave the animal anatomy visible.
    band=ball('Wrist wrap',(side*.34,1.43,-.53),(.21,.10,.21),dark)
    tube('Wrap piping',[(side*.34-.085,1.445,-.59),(side*.34,1.447,-.638),
         (side*.34+.085,1.445,-.59)],.009,cyan)

fuse('Feline head sculpt',[
    ball('Skull',(0,2.17,-.39),(.91,.71,.72),fur),
    ball('Jaw',(0,1.99,-.49),(.61,.40,.53),fur),
    ball('Left cheek',(-.32,2.055,-.47),(.35,.34,.42),fur),
    ball('Right cheek',(.32,2.055,-.47),(.35,.34,.42),fur),
    ball('Nasal bridge',(0,2.12,-.69),(.22,.32,.22),fur)])
# Muzzle lobes meet around a compact nose; chin sits beneath them.
fuse('Ivory muzzle sculpt',[
    ball('Whisker pad',(-.115,2.015,-.745),(.28,.21,.22),lightfur),
    ball('Whisker pad',(.115,2.015,-.745),(.28,.21,.22),lightfur),
    ball('Chin',(0,1.926,-.72),(.25,.14,.20),lightfur)],.009)

def cupped_ear(side,inset=False):
    # Curved triangular shell: rim is forward, interior recedes like a real pinna.
    if inset:
        a=(side*.215,2.36,-.493); b=(side*.451,2.34,-.379); c=(side*.467,2.685,-.358)
    else:
        a=(side*.145,2.325,-.47); b=(side*.515,2.27,-.31); c=(side*.49,2.765,-.305)
    corners=[Vector(a),Vector(b),Vector(c)]
    edge=[]
    for k in range(3):
        for j in range(8):
            t=j/8
            v=corners[k].lerp(corners[(k+1)%3],t)
            v.z-=.025*math.sin(t*math.pi)
            edge.append(v)
    center=sum(corners,Vector())/3; center.z+=.055
    verts=[xyz(center)]+[xyz(v) for v in edge]
    faces=[(0,i+1,(i+1)%len(edge)+1) for i in range(len(edge))]
    mesh=bpy.data.meshes.new('Cupped ear'); mesh.from_pydata(verts,[],faces); mesh.update()
    o=bpy.data.objects.new('Inner pinna' if inset else 'Outer ear',mesh)
    bpy.context.collection.objects.link(o); mesh.materials.append(ear_skin if inset else fur)
    for f in mesh.polygons: f.use_smooth=True
    sub=o.modifiers.new('Rounded ear','SUBSURF'); sub.levels=2
    solid=o.modifiers.new('Ear thickness','SOLIDIFY'); solid.thickness=.012 if inset else .055
    return o

# Almond surfaces taper to corners; no exposed white eyeballs.
for side in [-1,1]:
    cupped_ear(side); cupped_ear(side,True)
    center=side*.224
    outline=[]
    for j in range(48):
        t=2*math.pi*j/48
        u=math.cos(t)
        v=math.sin(t)*abs(math.sin(t))**.32
        x=center+.155*u
        y=2.20+.098*v+side*.024*u
        z=-.750+side*.22*(x-center)
        outline.append((x,y,z))
    # Convex iris-facing surface with its edge sunk into the skull.
    verts=[xyz((center,2.20,-.813))]+[xyz(v) for v in outline]
    mesh=bpy.data.meshes.new('Almond eye'); mesh.from_pydata(verts,[],[(0,j+1,(j+1)%48+1) for j in range(48)]); mesh.update()
    eye=bpy.data.objects.new('Almond jade eye',mesh); bpy.context.collection.objects.link(eye); mesh.materials.append(iris)
    for f in mesh.polygons: f.use_smooth=True
    tube('Dark eyelid edge',outline+[outline[0]],.010,rim_mat)
    ball('Vertical pupil',(center,2.20,-.817),(.039,.146,.024),black)
    ball('Corneal glint',(center-.032,2.239,-.827),(.025,.028,.012),cream)
    # Subtle brow mass follows the eye, without human eyebrows.
    tapered('Upper eyelid',[(center-.15,2.20-side*.024,-.754-side*.033),
        (center,2.304,-.761),(center+.15,2.20+side*.024,-.754+side*.033)],.024,fur,[.3,1,.3])
    for row in range(3):
        root=(side*(.14+row*.021),2.015-row*.025,-.851)
        tapered('Whisker',[root,(side*.37,2.01-row*.038,-.89),
            (side*(.60+row*.035),2.06-row*.075,-.84)],.003,whisker_mat,[1,.7,.04])
        for col in range(2):
            ball('Whisker follicle',(side*(.11+col*.055),2.04-row*.034,-.850),(.012,.012,.007),stripe)
    # Directional cheek markings and small tapered cheek tufts.
    for k in range(2):
        tapered('Cheek stripe',[(side*.34,2.13-k*.075,-.655),
            (side*.408,2.12-k*.068,-.58),(side*.435,2.13-k*.066,-.49)],.018,stripe,[.1,1,.05])
    for k in range(3):
        tapered('Cheek fur tuft',[(side*.37,2.03-k*.045,-.46),
            (side*(.50-k*.014),2.015-k*.052,-.40)],.054,fur,[1,.02])
# A small triangular feline nose, softly rounded.
verts=[(-.080,-.867,2.083),(.080,-.867,2.083),(0,-.893,2.010),
       (-.064,-.824,2.079),(.064,-.824,2.079),(0,-.844,2.018)]
mesh=bpy.data.meshes.new('Nose'); mesh.from_pydata(verts,[],[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)]); mesh.update()
o=bpy.data.objects.new('Triangular nose',mesh); bpy.context.collection.objects.link(o); mesh.materials.append(nose_mat)
bevel=o.modifiers.new('Rounded nose','BEVEL'); bevel.width=.018; bevel.segments=3
o.modifiers.new('Nose normals','WEIGHTED_NORMAL')
tube('Philtrum',[(0,2.021,-.865),(0,1.976,-.862)],.006,rim_mat)
for side in [-1,1]:
    tapered('Muzzle seam',[(0,1.976,-.862),(side*.068,1.96,-.841),(side*.14,1.973,-.817)],.006,rim_mat,[1,.8,.1])
# Forehead tabby lines lie against the curved skull.
for side in [-1,1]:
    tapered('Forehead marking',[(side*.055,2.32,-.714),(side*.09,2.405,-.659),
        (side*.16,2.46,-.57)],.022,stripe,[.05,1,.08])
# Long, tapered feline tail, sweeping behind the rider.
tapered('Sweeping tail',[(0,1.56,.53),(.20,1.67,.83),(.48,1.96,1.01),
    (.57,2.28,.96),(.46,2.51,.80),(.26,2.55,.66),(.14,2.48,.63)],.135,fur,[1.05,1,.88,.72,.52,.32,.015])
# Minimal harness across the shoulders.
tube('Harness collar',[(-.24,1.855,-.33),(0,1.81,-.427),(.24,1.855,-.33)],.036,dark)
tube('Collar accent',[(-.18,1.826,-.39),(0,1.801,-.461),(.18,1.826,-.39)],.009,cyan)
# Keep the asset grouped separately from presentation objects.
asset = bpy.data.collections.new('02 Feline cat and orb'); bpy.context.scene.collection.children.link(asset)
for o in list(bpy.context.scene.objects):
    for c in list(o.users_collection): c.objects.unlink(o)
    asset.objects.link(o)
bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=1.63, depth=.1, location=(0,0,-.10))
o = bpy.context.object; o.name = 'Display plinth'; o.data.materials.append(dark)
bevel = o.modifiers.new('Soft rim', 'BEVEL'); bevel.width = .05; bevel.segments = 3
bpy.ops.mesh.primitive_plane_add(size=200)
bpy.context.object.location.z = -.16; bpy.context.object.data.materials.append(mat('Backdrop', (.018,.027,.048)))

def aim(o, target): o.rotation_euler = (Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
for name, loc, power, color, size in [
    ('Soft key',(-3,-4,6),700,(.65,.83,1),4),
    ('Warm fill',(4,-2,3),500,(1,.72,.58),3),
    ('Blue rim',(1,3,5),900,(.25,.65,1),3)]:
    bpy.ops.object.light_add(type='AREA', location=loc)
    o=bpy.context.object; o.name=name; o.data.energy=power; o.data.color=color; o.data.shape='DISK'; o.data.size=size; aim(o,(0,0,1.3))
bpy.ops.object.camera_add(location=(3.6,-6.5,3.2))
cam = bpy.context.object; aim(cam,(0,0,1.35)); cam.data.type='ORTHO'; cam.data.ortho_scale=4.25
scene = bpy.context.scene; scene.camera = cam
scene.render.engine = 'CYCLES'; scene.cycles.samples = 40
scene.cycles.use_denoising = True
scene.world.color = (.12,.12,.12)
scene.render.resolution_x = 1100; scene.render.resolution_y = 1100; scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'; scene.render.filepath = str(OUT/'blue-cat-v2-preview.png')
# Export only the concept, with curves converted by the exporter.
bpy.ops.object.select_all(action='DESELECT')
for o in asset.objects: o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'blue-cat-v2.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'blue-cat-v2.glb'), use_selection=True, export_apply=True)
bpy.ops.render.render(write_still=True)
