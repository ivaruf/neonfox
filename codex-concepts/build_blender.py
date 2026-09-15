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
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=.5, location=xyz(p))
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
body = ball('Riding suit', (0,1.57,.10), (.72,.85,.67), dark)
body.rotation_euler.x = .35
ball('Chest patch', (0,1.68,-.24), (.45,.51,.16), cream)
for side in [-1,1]:
    ball('Haunch', (side*.40,1.40,.23), (.39,.44,.55), blue)
    ball('Boot', (side*.52,1.14,-.03), (.35,.27,.49), dark)
    tube('Reaching arm', [(side*.31,1.79,-.14),(side*.48,1.56,-.43),(side*.46,1.39,-.65)], .115, blue)
    ball('Cuff', (side*.46,1.43,-.60), (.30,.15,.27), cyan)
    ball('Paw', (side*.46,1.34,-.70), (.31,.22,.31), dark)
    for toe in [-1,0,1]:
        ball('Paw tip', (side*.46+toe*.075,1.33,-.84), (.065,.08,.085), cream)
ball('Head', (0,2.03,-.40), (1.14,.91,.87), blue)
for side in [-1,1]:
    x = side*.40
    for inset in [False,True]:
        w, bottom, top, front, back = (.21,2.20,2.62,-.635,-.61) if inset else (.36,2.13,2.78,-.61,-.30)
        verts = [(x-w,bottom,front),(x+w,bottom,front),(x*1.18,top,front),
                 (x-w,bottom,back),(x+w,bottom,back),(x*1.18,top,back)]
        faces = [(0,1,2),(3,5,4),(0,3,4,1),(1,4,5,2),(2,5,3,0)]
        mesh = bpy.data.meshes.new('Ear mesh'); mesh.from_pydata([xyz(p) for p in verts], [], faces); mesh.update()
        o = bpy.data.objects.new('Inner ear' if inset else 'Ear', mesh)
        bpy.context.collection.objects.link(o); mesh.materials.append(pink if inset else blue)
        bevel = o.modifiers.new('Soft edges', 'BEVEL'); bevel.width = .018; bevel.segments = 2
        o.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    ball('Cheek', (side*.27,1.89,-.73), (.49,.32,.31), cream)
    ball('Eye white', (side*.27,2.13,-.785), (.34,.36,.13), cream)
    ball('Iris', (side*.25,2.12,-.85), (.19,.25,.075), cyan)
    ball('Pupil', (side*.24,2.12,-.889), (.082,.20,.038), black)
    ball('Eye highlight', (side*.24-.035,2.18,-.91), (.055,.065,.025), cream)
    brow = ball('Brow', (side*.28,2.33,-.78), (.39,.075,.12), blue)
    brow.rotation_euler.y = side*.19
ball('Nose', (0,1.98,-.929), (.14,.10,.095), pink)
tube('Smile', [(-.15,1.86,-.896),(0,1.82,-.918),(.15,1.86,-.896)], .018, black)
tube('Collar', [(-.33,1.76,-.29),(0,1.69,-.36),(.33,1.76,-.29)], .055, cyan)
tube('Curled tail', [(0,1.48,.37),(.15,1.61,.84),(.32,1.94,1.12),(.20,2.30,1.13),(-.10,2.46,.96),(-.34,2.35,.87)], .18, blue)
ball('Tail tip', (-.34,2.35,.87), (.39,.37,.37), cream)
# Keep the asset grouped separately from presentation objects.
asset = bpy.data.collections.new('01 Blue cat and orb'); bpy.context.scene.collection.children.link(asset)
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
scene.render.engine = 'CYCLES'; scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.world.color = (.12,.12,.12)
scene.render.resolution_x = 1100; scene.render.resolution_y = 1100; scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'; scene.render.filepath = str(OUT/'blue-cat-preview.png')
# Export only the concept, with curves converted by the exporter.
bpy.ops.object.select_all(action='DESELECT')
for o in asset.objects: o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'blue-cat.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'blue-cat.glb'), use_selection=True, export_apply=True)
bpy.ops.render.render(write_still=True)
