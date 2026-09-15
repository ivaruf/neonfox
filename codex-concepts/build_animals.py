"""Three companion concepts based on the approved cat v3; run in Blender background."""
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

specs=[
    ('orange-fox',(.65,.19,.035),(.94,.76,.49),(.56,.11,.012),(1,.42,.035),(.52,.26,.055)),
    ('pink-bunny',(.60,.19,.32),(.93,.75,.77),(.48,.025,.16),(1,.10,.43),(.31,.15,.34)),
    ('purple-bear',(.24,.115,.43),(.67,.52,.78),(.17,.025,.42),(.61,.16,1),(.40,.28,.065)),
]
for name,fur_color,cream_color,orb_color,accent_color,eye_color in specs:
    bpy.ops.wm.open_mainfile(filepath=str(OUT/'blue-cat-v3.blend'))
    fur=recolor('Slate blue short fur',fur_color)
    cream=recolor('Warm ivory muzzle',cream_color)
    recolor('Azure orb',orb_color); recolor('Energy rings',accent_color)
    recolor('Cyan accents',accent_color); recolor('Jade iris',eye_color)
    pink=recolor('Muted inner ear',(.43,.16,.19) if name=='orange-fox' else (.58,.23,.36) if name=='pink-bunny' else (.43,.27,.53))
    nose=material('Soft dark nose',(.055,.027,.033))
    remove(['Sweeping tail','Whisker','Cheek stripe','Forehead marking',
            'Ivory muzzle sculpt','Triangular nose','Philtrum','Muzzle seam'])
    if name=='orange-fox':
        # Long cream snout, cheek ruff, and a full brush tail distinguish the fox.
        for side in [-1,1]:
            cheek=ball('Cream fox cheek',(side*.275,-.655,2.025),(.42,.28,.28),cream)
            cheek.rotation_euler.y=side*-.23
            ball('Fox muzzle',(side*.072,-.853,2.015),(.24,.37,.19),cream)
        ball('Fox nose',(0,-1.029,2.064),(.145,.105,.095),nose)
        curve('Fox mouth',[(0,-1.013,2.027),(0,-.995,1.97),(.10,-.941,1.982)],.006,[1,1,.1],nose)
        curve('Brush tail',[(0,.57,1.55),(-.25,.89,1.57),(-.62,1.03,1.88),(-.64,.99,2.19)],.26,[.6,1.15,1.05,.65],fur)
        curve('Ivory brush tip',[(-.65,.995,2.15),(-.58,.94,2.32),(-.40,.87,2.43)],.18,[1,.72,.02],cream)
        for side in [-1,1]:
            curve('Fox cheek ruff',[(side*.38,-.42,2.05),(side*.53,-.36,2.03)],.08,[1,.01],cream)
    elif name=='pink-bunny':
        remove(['Outer ear','Inner pinna','Cheek fur tuft'])
        # Long ears: one upright, one gently tipped outward.
        for side in [-1,1]:
            tilt=side*(.16 if side==1 else .09)
            ear=ball('Long bunny ear',(side*.34,-.24,2.78),(.27,.20,.98),fur)
            ear.rotation_euler.y=tilt
            inner=ball('Soft ear interior',(side*.34,-.343,2.79),(.145,.035,.77),pink)
            inner.rotation_euler.y=tilt
            ball('Bunny muzzle',(side*.105,-.803,2.017),(.25,.21,.22),cream)
        ball('Rose bunny nose',(0,-.923,2.073),(.107,.065,.075),pink)
        for side in [-1,1]:
            tooth=ball('Tiny front tooth',(side*.032,-.887,1.934),(.055,.045,.085),cream)
        ball('Cotton tail',(.36,.71,1.63),(.44,.42,.43),cream)
        curve('Bunny mouth',[(0,-.916,2.04),(0,-.909,1.986),(.09,-.876,1.973)],.005,[1,1,.05],nose)
    else:
        remove(['Outer ear','Inner pinna','Cheek fur tuft'])
        # Round ears and an oval muzzle give the bear a different silhouette.
        for side in [-1,1]:
            ball('Round bear ear',(side*.39,-.285,2.52),(.38,.22,.39),fur)
            ball('Bear ear interior',(side*.39,-.397,2.53),(.225,.035,.235),pink)
        ball('Bear muzzle',(0,-.786,2.047),(.44,.24,.32),cream)
        ball('Bear button nose',(0,-.923,2.119),(.18,.079,.12),nose)
        curve('Bear philtrum',[(0,-.924,2.076),(0,-.921,2.00)],.006,[1,.8],nose)
        for side in [-1,1]:
            curve('Bear smile',[(0,-.921,2.00),(side*.062,-.910,1.983),(side*.12,-.885,2.013)],.006,[.8,1,.05],nose)
        ball('Bear tail',(.28,.70,1.58),(.23,.23,.23),fur)
    bpy.context.view_layer.update()
    bpy.data.objects['RiderRoot']['species']=name
    asset=bpy.data.collections['03 Cat and orb']; asset.name=name
    bpy.context.scene.camera.data.ortho_scale=4.5
    bpy.ops.object.select_all(action='DESELECT')
    bpy.data.objects['RiderRoot'].select_set(True)
    bpy.context.view_layer.objects.active=bpy.data.objects['RiderRoot']
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(name+'.blend')))
    export_selected(name+'.glb',list(asset.all_objects))
    export_selected(name+'-rider.glb',list(bpy.data.collections['Rider'].objects))
    export_selected(name+'-orb.glb',list(bpy.data.collections['Orb'].objects))

# One shared review render; no gameplay or animations.
bpy.ops.wm.read_factory_settings(use_empty=True)
for idx,(name,*_) in enumerate(specs):
    with bpy.data.libraries.load(str(OUT/(name+'.blend')),link=False) as (src,dst):
        dst.collections=[name]
    collection=dst.collections[0]; bpy.context.scene.collection.children.link(collection)
    root=next(o for o in collection.objects if o.name.startswith('PlayerRoot'))
    root.location.x=(idx-1)*3.2; root.rotation_euler.z=-.12
    bpy.ops.mesh.primitive_cylinder_add(vertices=80,radius=1.37,depth=.1,location=((idx-1)*3.2,0,-.10))
    o=bpy.context.object; o.name=name+' pedestal'; o.data.materials.append(material(name+' pedestal finish',(.025,.035,.052)))
    b=o.modifiers.new('Soft pedestal rim','BEVEL'); b.width=.04; b.segments=3
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.16))
bpy.context.object.data.materials.append(material('Studio ground',(.017,.023,.035)))
for name,loc,power,color,size in [
    ('Key',(-4,-5,7),1450,(.85,.9,1),6),('Fill',(5,-4,5),1200,(1,.81,.72),5),
    ('Rim',(0,4,7),1700,(.65,.76,1),6)]:
    bpy.ops.object.light_add(type='AREA',location=loc); o=bpy.context.object; o.name=name
    o.data.energy=power; o.data.color=color; o.data.shape='DISK'; o.data.size=size; aim(o,(0,0,1.4))
bpy.ops.object.camera_add(location=(3.8,-14,6.1)); cam=bpy.context.object; aim(cam,(0,0,1.45))
cam.data.type='ORTHO'; cam.data.ortho_scale=10.5
scene=bpy.context.scene; scene.camera=cam
scene.world=bpy.data.worlds.new('Studio world'); scene.world.color=(.09,.09,.09)
scene.render.engine='CYCLES'; scene.cycles.samples=40; scene.cycles.use_denoising=True
scene.render.resolution_x=1680; scene.render.resolution_y=900; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.filepath=str(OUT/'animal-lineup-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'animal-lineup.blend'))
bpy.ops.render.render(write_still=True)
