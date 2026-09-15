"""One dog companion based on the approved cat v3; run in Blender background."""
import bpy, math
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).resolve().parent

def material(name,color,glow=0):
    m=bpy.data.materials.new(name); m.use_nodes=True
    m.diffuse_color=(*color,1)
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=.68
    p.inputs['Emission Color'].default_value=(*color,1)
    p.inputs['Emission Strength'].default_value=glow
    return m

def recolor(name,color):
    m=bpy.data.materials[name]
    m.diffuse_color=(*color,1)
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Emission Color'].default_value=(*color,1)
    return m

def attach(o,mat):
    o.data.materials.append(mat)
    bpy.context.view_layer.update(); world=o.matrix_world.copy()
    for c in list(o.users_collection): c.objects.unlink(o)
    bpy.data.collections['Rider'].objects.link(o)
    o.parent=bpy.data.objects['RiderRoot']; o.matrix_world=world
    return o

def ball(name,loc,size,mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40,ring_count=24,radius=.5,location=loc)
    o=bpy.context.object; o.name=name; o.scale=size
    for p in o.data.polygons: p.use_smooth=True
    return attach(o,mat)

def curve(name,points,radius,radii,mat):
    c=bpy.data.curves.new(name,'CURVE'); c.dimensions='3D'; c.resolution_u=20
    c.bevel_depth=radius; c.bevel_resolution=4; c.use_fill_caps=True
    s=c.splines.new('BEZIER'); s.bezier_points.add(len(points)-1)
    for b,p,r in zip(s.bezier_points,points,radii):
        b.co=p; b.radius=r; b.handle_left_type=b.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,c); bpy.context.collection.objects.link(o)
    return attach(o,mat)

def remove(prefixes):
    for o in list(bpy.data.collections['Rider'].objects):
        if any(o.name.startswith(n) for n in prefixes): bpy.data.objects.remove(o,do_unlink=True)

def aim(o,p): o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()

def export_selected(path,objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/path),use_selection=True,export_apply=True)

bpy.ops.wm.open_mainfile(filepath=str(OUT/'blue-cat-v3.blend'))
fur=recolor('Slate blue short fur',(.46,.265,.115))
cream=recolor('Warm ivory muzzle',(.88,.78,.59))
ears=material('Warm chocolate ears',(.17,.073,.032))
nose=material('Puppy nose',(.035,.022,.018))
tongue=material('Pink tongue',(.65,.18,.23))
recolor('Azure orb',(.018,.32,.055))
recolor('Energy rings',(.20,1,.12))
recolor('Cyan accents',(.16,.80,.075))
recolor('Jade iris',(.40,.235,.065))
remove(['Sweeping tail','Whisker','Cheek stripe','Forehead marking','Cheek fur tuft',
        'Outer ear','Inner pinna','Ivory muzzle sculpt','Triangular nose','Philtrum','Muzzle seam'])
for side in [-1,1]:
    ear=ball('Floppy puppy ear',(side*.49,-.29,2.20),(.34,.30,.68),ears)
    ear.rotation_euler.y=-side*.24
    ball('Puppy muzzle',(side*.107,-.838,2.025),(.32,.32,.245),cream)
    # Soft warm eyebrow spots read as a friendly puppy expression.
    brow=ball('Ivory brow spot',(side*.243,-.671,2.37),(.14,.065,.070),cream)
    brow.rotation_euler.y=side*.12
ball('Lower lip',(0,-.895,1.951),(.24,.10,.10),nose)
ball('Little tongue',(0,-.950,1.925),(.107,.058,.143),tongue)
curve('Tongue crease',[(0,-.981,1.971),(0,-.985,1.925)],.003,[.6,.1],nose)
ball('Puppy button nose',(0,-1.004,2.102),(.20,.11,.125),nose)
curve('Nose to mouth',[(0,-.999,2.064),(0,-.994,2.008)],.006,[1,.8],nose)
for side in [-1,1]:
    curve('Puppy smile',[(0,-.994,2.008),(side*.093,-.978,1.985),(side*.18,-.904,2.016)],.006,[.8,1,.08],nose)
curve('Happy raised tail',[(0,.57,1.55),(.24,.85,1.64),(.46,.95,1.93),(.53,.91,2.15)],.105,[1.1,1,.70,.07],fur)
# A small green collar tag links the warm-colored dog to its orb.
ball('Green collar tag',(0,-.461,1.765),(.09,.035,.105),bpy.data.materials['Cyan accents'])
bpy.context.view_layer.update()
asset=bpy.data.collections['03 Cat and orb']; asset.name='Green dog and orb'
bpy.data.objects['RiderRoot']['species']='Dog'
bpy.ops.object.select_all(action='DESELECT')
bpy.data.objects['RiderRoot'].select_set(True)
bpy.context.view_layer.objects.active=bpy.data.objects['RiderRoot']
scene=bpy.context.scene
scene.render.filepath=str(OUT/'green-dog-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'green-dog.blend'))
export_selected('green-dog.glb',list(asset.all_objects))
export_selected('green-dog-rider.glb',list(bpy.data.collections['Rider'].objects))
export_selected('green-dog-orb.glb',list(bpy.data.collections['Orb'].objects))
bpy.ops.render.render(write_still=True)
