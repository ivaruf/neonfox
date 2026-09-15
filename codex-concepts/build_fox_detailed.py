"""Detailed cartoon fox with a two-second cruising loop; run in Blender background."""
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

from mathutils import Matrix
bpy.ops.wm.open_mainfile(filepath=str(OUT/'orange-fox.blend'))
scene=bpy.context.scene
scene.name='Cruise_Wind'
scene.frame_start=1; scene.frame_end=49; scene.render.fps=24
rider=bpy.data.objects['RiderRoot']; orb_root=bpy.data.objects['OrbRoot']
collection=bpy.data.collections['Rider']
remove(['Brush tail','Ivory brush tip','Cream fox cheek','Fox muzzle','Fox nose','Fox mouth',
        'Fox cheek ruff','Cheek fur tuft','Chest bib','Almond jade eye','Dark eyelid edge',
        'Soft oval pupil','Corneal glint','Small eye glint'])
fur=recolor('Slate blue short fur',(.61,.155,.023))
ivory=recolor('Warm ivory muzzle',(.90,.79,.58))
russet=material('Russet fur shadows',(.32,.062,.012))
honey=material('Golden fur tips',(.78,.28,.041))
light=material('Cream fur highlights',(.98,.89,.70))
ink=material('Espresso eyelids and nose',(.024,.011,.008))
leather=material('Soft oxblood harness',(.074,.029,.021))
stitch=material('Golden stitching',(.68,.43,.16))
metal=material('Antique brass',(.40,.225,.058))
metal.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=.7
metal.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.26
for mat in [fur,ivory,russet,honey,light]:
    p=mat.node_tree.nodes.get('Principled BSDF'); p.inputs['Roughness'].default_value=.78
    p.inputs['Sheen Weight'].default_value=.3
    if not any(n.type=='BUMP' for n in mat.node_tree.nodes):
        n=mat.node_tree.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value=150
        bump=mat.node_tree.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.14; bump.inputs['Distance'].default_value=.008
        mat.node_tree.links.new(n.outputs['Fac'],bump.inputs['Height']); mat.node_tree.links.new(bump.outputs['Normal'],p.inputs['Normal'])

# Sculpt the muzzle as a single soft wedge, with full cheek pads and a pointed snout.
def join_sculpt(name,parts,voxel=.012):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts: obj.select_set(True)
    bpy.context.view_layer.objects.active=parts[0]
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    bpy.ops.object.join(); obj=bpy.context.object; obj.name=name
    m=obj.modifiers.new('Sculpt union','REMESH'); m.mode='VOXEL'; m.voxel_size=voxel
    bpy.ops.object.modifier_apply(modifier=m.name)
    m=obj.modifiers.new('Sculpt smoothing','SMOOTH'); m.factor=1; m.iterations=5
    bpy.ops.object.modifier_apply(modifier=m.name)
    m=obj.modifiers.new('Sculpt finish','SUBSURF'); m.levels=1
    for p in obj.data.polygons: p.use_smooth=True
    return obj
parts=[ball('Muzzle bridge',(0,-.867,2.035),(.33,.40,.235),ivory),
       ball('Chin',(0,-.852,1.935),(.27,.27,.13),ivory)]
for side in [-1,1]:
    parts.append(ball('Fox whisker pad',(side*.137,-.80,2.02),(.30,.28,.23),ivory))
join_sculpt('Sculpted fox muzzle',parts)
ball('Velvet triangular nose',(0,-1.057,2.085),(.159,.109,.10),ink)
ball('Nose soft highlight',(-.026,-1.112,2.108),(.052,.008,.014),russet)
curve('Philtrum',[(0,-1.098,2.063),(0,-1.06,2.003)],.006,[1,.8],ink)
for side in [-1,1]:
    curve('Gentle smile',[(0,-1.06,2.003),(side*.075,-1.004,1.972),(side*.16,-.92,2.002)],.006,[.6,1,.08],ink)
    for j in range(3):
        ball('Whisker pore',(side*(.12+j*.033),-.944+j*.020,2.037-j*.022),(.010,.007,.010),russet)
        curve('Fine whisker',[(side*.18,-.923,2.025-j*.024),(side*.36,-.91,2.033-j*.03),
            (side*.54,-.78,2.045-j*.05)],.002,[1,.7,.015],light)

# Rounded amber eyes, colored iris rings and small catchlights.
white=material('Warm eye white',(.76,.72,.59))
amber=material('Iris amber',(.59,.245,.025))
iris_light=material('Iris honey',(.91,.49,.065))
catch=material('Eye catchlight',(1,.97,.88))
for side in [-1,1]:
    cx=side*.239
    ball('Eye socket',(cx,-.752,2.205),(.385,.131,.311),russet)
    ball('Eye almond',(cx,-.797,2.202),(.343,.110,.267),white)
    ball('Amber iris',(cx-side*.006,-.853,2.203),(.224,.049,.236),amber)
    ball('Inner iris',(cx-side*.008,-.879,2.196),(.175,.016,.193),iris_light)
    ball('Pupil',(cx-side*.010,-.893,2.207),(.119,.019,.180),ink)
    ball('Main catchlight',(cx-.042,-.905,2.264),(.046,.012,.048),catch)
    ball('Secondary catchlight',(cx+.021,-.907,2.163),(.017,.010,.019),catch)
    for j in range(12):
        t=2*math.pi*j/12
        x=cx+math.cos(t)*.094; z=2.20+math.sin(t)*.103
        curve('Iris striation',[(x,-.881,z),(cx+math.cos(t)*.084,-.89,2.20+math.sin(t)*.090)],.002,[.3,.1],amber)
    curve('Upper eyelid',[(cx-.157,-.81,2.20),(cx-.07,-.837,2.326),
        (cx+.07,-.819,2.322),(cx+.163,-.78,2.21)],.012,[.2,1,1,.15],ink)

# Solid, tapered fur locks: deliberately sculpted cartoon clumps, not hair strands.
def lock(name,points,width,mat,flatten=.48):
    pts=[Vector(p) for p in points]; verts=[]; faces=[]
    count=9; sides=8
    for i in range(count):
        t=i/(count-1)
        c=(1-t)**2*pts[0]+2*t*(1-t)*pts[1]+t*t*pts[2]
        direction=(2*(1-t)*(pts[1]-pts[0])+2*t*(pts[2]-pts[1])).normalized()
        across=direction.cross(Vector((0,0,1)))
        if across.length<.1: across=direction.cross(Vector((0,1,0)))
        across.normalize(); normal=direction.cross(across).normalized()
        radius=width*(.62+.5*math.sin(math.pi*t))*(1-t)**.7+.0005
        for j in range(sides):
            a=2*math.pi*j/sides
            verts.append(tuple(c+across*math.cos(a)*radius+normal*math.sin(a)*radius*flatten))
    for i in range(count-1):
        for j in range(sides): faces.append((i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j))
    faces.append(tuple(reversed(range(sides)))); faces.append(tuple((count-1)*sides+j for j in range(sides)))
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(verts,[],faces); mesh.update()
    o=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(o)
    for p in mesh.polygons: p.use_smooth=True
    return attach(o,mat)

wind_locks=[]
for side in [-1,1]:
    # Cream cheek fans and orange guard hairs trail backward with the airflow.
    for j in range(6):
        a=(side*(.25+.025*j),-.60+j*.035,2.05-j*.024)
        b=(side*(.43+.012*j),-.41+j*.04,2.01-j*.028)
        c=(side*(.51+.015*j),-.19+j*.052,2.02-j*.034)
        obj=lock('Wind swept cheek fur',[a,b,c],.073,ivory if j%2 else light)
        wind_locks.append((obj,a,j*.6+side))
    for j in range(3):
        a=(side*.37,-.33+j*.055,2.17-j*.045)
        obj=lock('Orange cheek guard fur',[a,(side*.53,-.13+j*.04,2.15-j*.04),
                (side*.54,.10+j*.06,2.16-j*.04)],.058,honey if j%2 else fur)
        wind_locks.append((obj,a,j+side))
    for j in range(4):
        a=(side*(.065+j*.048),-.399,1.84-j*.012)
        obj=lock('Layered cream chest ruff',[a,(side*(.09+j*.067),-.46,1.69),
             (side*(.11+j*.082),-.36,1.54+j*.025)],.065,light if j%2 else ivory)
        wind_locks.append((obj,a,j*.4))
    for j in range(3):
        lock('Ankle fur',[(side*.36,.30,1.32+j*.04),(side*.47,.40,1.27+j*.04),
            (side*.49,.51,1.30+j*.04)],.048,fur)
for j in range(5):
    x=(j-2)*.085
    a=(x,-.31,2.48)
    obj=lock('Swept crown forelock',[a,(x+.025,-.11,2.62),(x+.05,.14,2.58-j*.008)],.067,honey if j%2 else fur)
    wind_locks.append((obj,a,j*.8))

# Ear edge tufts follow the pinna. Existing ears get their own subtle wind pivots.
for side in [-1,1]:
    for j in range(3):
        a=(side*(.42+j*.018),-.34,2.40+j*.063)
        lock('Ear edge fur',[a,(side*.51,-.23,2.46+j*.06),(side*.53,-.10,2.46+j*.06)],.038,fur)

# Tail mesh with six weighted joints, streaming well behind the body.
centers=[Vector(p) for p in [(0,.54,1.55),(.10,.90,1.56),(.21,1.26,1.62),
    (.27,1.64,1.70),(.27,2.00,1.80),(.18,2.36,1.91),(.03,2.66,2.05)]]
segments=36; sides=20; verts=[]; faces=[]; material_indices=[]
def tail_center(t):
    q=t*6; i=min(5,int(q)); return centers[i].lerp(centers[i+1],q-i)
for i in range(segments+1):
    t=i/segments; c=tail_center(t)
    r=(.16+.20*math.sin(math.pi*t))*(1-t)**.48+.004
    for j in range(sides):
        a=2*math.pi*j/sides
        verts.append(tuple(c+Vector((math.cos(a)*r,0,math.sin(a)*r*.85))))
for i in range(segments):
    for j in range(sides):
        faces.append((i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j))
        material_indices.append(1 if i/segments>.67+.035*math.sin(j*2.1) else 0)
faces.extend([tuple(reversed(range(sides))),tuple(segments*sides+j for j in range(sides))]); material_indices.extend([0,1])
mesh=bpy.data.meshes.new('Flowing brush tail'); mesh.from_pydata(verts,[],faces); mesh.update()
tail=bpy.data.objects.new('Flowing brush tail',mesh); bpy.context.collection.objects.link(tail); attach(tail,fur); mesh.materials.append(ivory)
for f,mi in zip(mesh.polygons,material_indices): f.material_index=mi; f.use_smooth=True
tail_parts=[tail]
for row in range(5):
    t=.18+row*.14; c=tail_center(t); r=(.16+.20*math.sin(math.pi*t))*(1-t)**.48
    for j in range(6):
        a=j*math.pi/3+.25*(row%2); off=Vector((math.cos(a),0,math.sin(a)*.85))
        root=c+off*r*.88; middle=tail_center(min(.99,t+.09))+off*r*1.14
        tip=tail_center(min(1,t+.22))+off*r*.8
        tail_parts.append(lock('Tail feather layer',[root,middle,tip],.08,ivory if t>.64 else honey if j%3==0 else fur))

# A simple, intentionally small deformation rig for this first polished rider.
bpy.ops.object.armature_add(location=(0,0,0))
rig=bpy.context.object; rig.name='FoxTailRig'
for c in list(rig.users_collection): c.objects.unlink(rig)
collection.objects.link(rig)
bpy.ops.object.mode_set(mode='EDIT'); rig.data.edit_bones.remove(rig.data.edit_bones[0])
prev=None
for i in range(6):
    b=rig.data.edit_bones.new('Tail_%02d'%i); b.head=centers[i]; b.tail=centers[i+1]
    if prev: b.parent=prev; b.use_connect=True
    prev=b
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.update(); world=rig.matrix_world.copy(); rig.parent=rider; rig.matrix_world=world
for obj in tail_parts:
    groups=[obj.vertex_groups.new(name='Tail_%02d'%i) for i in range(6)]
    # All tail mesh vertices use authored world-space coordinates with identity geometry transforms.
    for v in obj.data.vertices:
        q=max(0,min(5,(v.co.y-.54)/(2.66-.54)*6-.5)); lo=int(q); hi=min(5,lo+1); f=q-lo
        groups[lo].add([v.index],1-f,'REPLACE')
        if hi!=lo and f: groups[hi].add([v.index],f,'REPLACE')
    mod=obj.modifiers.new('Wind tail deformation','ARMATURE'); mod.object=rig
    bpy.context.view_layer.update(); world=obj.matrix_world.copy(); obj.parent=rig; obj.matrix_world=world

# Stitching, brass fasteners, and toe seams provide close-up detail without busy textures.
for side in [-1,1]:
    for j in range(7):
        x=side*.34+(j-3)*.021
        curve('Cuff stitching',[(x,-.639,1.445),(x,-.639,1.463)],.0025,[1,1],stitch)
    ball('Cuff rivet',(side*.415,-.571,1.448),(.035,.028,.035),metal)
    for j in [-1,1]:
        curve('Soft toe seam',[(side*.34+j*.04,-.762,1.36),(side*.34+j*.04,-.776,1.315)],.004,[.15,.65],russet)
    curve('Harness shoulder strap',[(side*.19,-.33,1.90),(side*.27,-.08,1.93),(side*.24,.23,1.80)],.033,[1,1,1],leather)
    for j in range(4):
        ball('Harness stud',(side*.277,-.13+j*.06,1.955-j*.012),(.025,.025,.017),metal)

# RiderRoot remains the independent jump/flip control; CruiseMotion handles only the loop.
bpy.context.view_layer.update()
cruise=bpy.data.objects.new('CruiseMotion',None); collection.objects.link(cruise)
cruise.location=(0,0,1.90); bpy.context.view_layer.update()
w=cruise.matrix_world.copy(); cruise.parent=rider; cruise.matrix_world=w
for obj in list(collection.objects):
    if obj not in (rider,cruise) and obj.parent==rider:
        w=obj.matrix_world.copy(); obj.parent=cruise; obj.matrix_world=w
# Lean forward from the torso; the movement layer has its own base pose.
base_rot=-.085
# Wind pivots sit at each tuft root. Animate small angles, not disconnected translations.
wind_controls=[]
for obj,loc,phase in wind_locks:
    control=bpy.data.objects.new('FurWind',None); collection.objects.link(control); control.location=loc
    bpy.context.view_layer.update(); w=control.matrix_world.copy(); control.parent=cruise; control.matrix_world=w
    bpy.context.view_layer.update(); w=obj.matrix_world.copy(); obj.parent=control; obj.matrix_world=w
    wind_controls.append((control,phase))
for side in [-1,1]:
    control=bpy.data.objects.new('EarWind',None); collection.objects.link(control); control.location=(side*.34,-.32,2.34)
    bpy.context.view_layer.update(); w=control.matrix_world.copy(); control.parent=cruise; control.matrix_world=w
    for obj in list(collection.objects):
        if obj.name.startswith(('Outer ear','Inner pinna','Ear edge fur')):
            bpy.context.view_layer.update()
            # Ear meshes may have a zero origin; use evaluated world bounds to identify side.
            center=sum((obj.matrix_world@Vector(p) for p in obj.bound_box),Vector())/8
            if center.x*side>0:
                w=obj.matrix_world.copy(); obj.parent=control; obj.matrix_world=w
    wind_controls.append((control,side*1.3))
rest=cruise.location.copy()
for frame in range(1,50,3):
    t=(frame-1)/48*2*math.pi
    cruise.location=rest+Vector((0,0,.018*math.sin(t)))
    cruise.rotation_euler=(base_rot+.012*math.sin(t),.015*math.sin(t),.018*math.sin(t+.5))
    cruise.keyframe_insert('location',frame=frame); cruise.keyframe_insert('rotation_euler',frame=frame)
    for i,b in enumerate(rig.pose.bones):
        b.rotation_mode='XYZ'
        b.rotation_euler=(.018*math.sin(t-i*.55),0,(.025+i*.009)*math.sin(t-i*.55))
        b.keyframe_insert('rotation_euler',frame=frame)
    for ctrl,phase in wind_controls:
        ctrl.rotation_euler=(.035*math.sin(t+phase),.014*math.sin(t+phase),.025*math.sin(t+phase+.6))
        ctrl.keyframe_insert('rotation_euler',frame=frame)
rider['animation_notes']='Cruise_Wind is a 2-second loop. Animate RiderRoot independently for hops/flips; the loop lives on CruiseMotion and secondary controls.'
rig['scope']='Six-bone tail deformation; no full-body or facial rig yet.'
scene.frame_set(1)
# Render with enough rear space to read the streaming tail.
cam=scene.camera; cam.location=(4.5,-6.4,3.7); aim(cam,(0,.58,1.55)); cam.data.ortho_scale=4.5
scene.render.resolution_x=1300; scene.render.resolution_y=1050; scene.render.resolution_percentage=100
scene.cycles.samples=48
scene.render.filepath=str(OUT/'fox-detailed-preview.png')
asset=bpy.data.collections['orange-fox']; asset.name='Detailed fox and orb'
bpy.ops.object.select_all(action='DESELECT'); rider.select_set(True); bpy.context.view_layer.objects.active=rider
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'fox-detailed.blend'))
# Scene sampling keeps transform and bone tracks together as one cruising clip.
def export_anim(filename,objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/filename),use_selection=True,export_apply=True,
        export_animations=True,export_animation_mode='SCENE',export_force_sampling=True)
export_anim('fox-detailed.glb',list(asset.all_objects))
export_anim('fox-detailed-rider.glb',list(collection.objects))
export_selected('fox-detailed-orb.glb',list(bpy.data.collections['Orb'].objects))
import sys
sys.path.insert(0,str(OUT))
from merge_cruise_clip import merge_cruise_clip
for filename in ['fox-detailed.glb','fox-detailed-rider.glb']:
    merge_cruise_clip(OUT/filename)
bpy.ops.render.render(write_still=True)
# Lightweight art animation preview, not a game test. Keep the saved Blender scene at full quality.
scene.render.engine='CYCLES'; scene.cycles.samples=8
scene.render.resolution_x=780; scene.render.resolution_y=630
frames=OUT/'fox-cruise-frames'; frames.mkdir(exist_ok=True)
scene.render.filepath=str(frames/'frame-')
scene.frame_end=47; scene.frame_step=2
bpy.ops.render.render(animation=True)
