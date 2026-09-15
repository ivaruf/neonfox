"""Detailed fox running on its orb; authored art-animation preview; run in Blender background."""
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
import sys,json,struct
bpy.ops.wm.open_mainfile(filepath=str(OUT/'fox-detailed.blend'))
scene=bpy.context.scene; scene.frame_set(1)
rider=bpy.data.objects['RiderRoot']; motion=bpy.data.objects['CruiseMotion']
collection=bpy.data.collections['Rider']; tailrig=bpy.data.objects['FoxTailRig']
# This file is a separate run study; the existing cruising source is untouched.
for obj in collection.objects:
    obj.animation_data_clear()
    if obj.type=='ARMATURE':
        for b in obj.pose.bones: b.matrix_basis=Matrix.Identity(4)
    if obj.name.startswith(('FurWind','EarWind')): obj.rotation_euler=(0,0,0)
motion.rotation_euler=(0,0,0); motion.location=(0,.04,.23)
bpy.context.view_layer.update()
remove(['Foreleg and soft paw','Bent rear leg','Wrist wrap','Wrap piping','Cuff stitching',
        'Cuff rivet','Soft toe seam','Ankle fur'])
fur=bpy.data.materials['Slate blue short fur']; cream=bpy.data.materials['Warm ivory muzzle']
leather=bpy.data.materials['Soft oxblood harness']; gold=bpy.data.materials['Antique brass']
# The sphere surface is sampled at the paws' lateral offset.
R=.72; CZ=.78; X=.255
side_radius=math.sqrt(R*R-X*X)
def foot_at(phi,lift=0,side=1):
    surface=Vector((side*X,side_radius*math.sin(phi),CZ+side_radius*math.cos(phi)))
    normal=(surface-Vector((0,0,CZ))).normalized()
    center=surface+normal*.067+Vector((0,0,lift))
    forward=Vector((0,-math.cos(phi),math.sin(phi)))
    return center,forward

def solve_elbow(hip,foot,l1,l2,hint):
    delta=foot-hip; d=max(.0001,delta.length)
    if d>l1+l2-.002: raise ValueError('Unreachable paw: '+str(d))
    along=delta/d; a=(l1*l1-l2*l2+d*d)/(2*d)
    h=math.sqrt(max(0,l1*l1-a*a))
    bend=Vector(hint)-along*Vector(hint).dot(along); bend.normalize()
    return hip+along*a+bend*h

# Twelve bones: upper leg, lower leg, and paw for each limb.
bpy.ops.object.armature_add(location=(0,0,0)); rig=bpy.context.object; rig.name='FoxRunRig'
for c in list(rig.users_collection): c.objects.unlink(rig)
collection.objects.link(rig)
bpy.ops.object.mode_set(mode='EDIT'); rig.data.edit_bones.remove(rig.data.edit_bones[0])
legs=[]
for label,side,front,phase in [('LF',-1,True,0),('RF',1,True,.5),('LH',-1,False,.5),('RH',1,False,0)]:
    hip=Vector((side*(.27 if front else .30),-.18 if front else .35,2.015 if front else 1.90))
    l1,l2=(.405,.385) if front else (.35,.34)
    phi=-.33 if front else .30
    foot,tangent=foot_at(phi,0,side)
    elbow=solve_elbow(hip,foot,l1,l2,(0,1 if front else -1,0))
    pts=[hip,elbow,foot,foot+tangent*.17]
    names=[label+'_Upper',label+'_Lower',label+'_Paw']; prev=None
    for i,name in enumerate(names):
        b=rig.data.edit_bones.new(name); b.head=pts[i]; b.tail=pts[i+1]
        if prev: b.parent=prev; b.use_connect=True
        prev=b
    legs.append(dict(label=label,side=side,front=front,phase=phase,hip=hip,l1=l1,l2=l2,points=pts,names=names))
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.update(); w=rig.matrix_world.copy(); rig.parent=motion; rig.matrix_world=w

def bind(obj,names,weights):
    groups=[obj.vertex_groups.new(name=n) for n in names]
    for i,ws in enumerate(weights):
        for group,value in zip(groups,ws):
            if value>0: group.add([i],value,'REPLACE')
    bpy.context.view_layer.update(); world=obj.matrix_world.copy(); obj.parent=rig; obj.matrix_world=world
    modifier=obj.modifiers.new('Running leg skin','ARMATURE'); modifier.object=rig

def sphere_part(name,loc,size,mat,bone,direction=None):
    obj=ball(name,loc,size,mat)
    if direction is not None: obj.rotation_euler=Vector(direction).to_track_quat('-Y','Z').to_euler()
    bind(obj,[bone],[[1] for _ in obj.data.vertices])
    return obj

for leg in legs:
    hip,elbow,foot,toe=leg['points']; verts=[]; faces=[]; weights=[]
    n=24; sides=12
    for i in range(n+1):
        t=i/n*2
        center=hip.lerp(elbow,t) if t<=1 else elbow.lerp(foot,t-1)
        # Blend tangent at the elbow to round the joint.
        a=(elbow-hip).normalized(); b=(foot-elbow).normalized()
        mix=max(0,min(1,(t-.75)/.5)); direction=a.lerp(b,mix).normalized()
        across=direction.cross(Vector((1,0,0))).normalized(); normal=direction.cross(across).normalized()
        radius=(.124 if leg['front'] else .158)*(1-i/n)+.070*(i/n)
        blend=max(0,min(1,(t-.70)/.60)); blend=blend*blend*(3-2*blend)
        for j in range(sides):
            theta=2*math.pi*j/sides
            verts.append(tuple(center+radius*(math.cos(theta)*across+math.sin(theta)*normal)))
            weights.append((1-blend,blend,0))
    for i in range(n):
        for j in range(sides): faces.append((i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j))
    faces.extend([tuple(reversed(range(sides))),tuple(n*sides+j for j in range(sides))])
    mesh=bpy.data.meshes.new(leg['label']+' leg mesh'); mesh.from_pydata(verts,[],faces); mesh.update()
    obj=bpy.data.objects.new(leg['label']+' articulated leg',mesh); bpy.context.collection.objects.link(obj); attach(obj,fur)
    for p in mesh.polygons: p.use_smooth=True
    bind(obj,leg['names'],weights)
    smooth=obj.modifiers.new('Soft leg contours','SUBSURF'); smooth.levels=2
    sphere_part(leg['label']+' shoulder blend',hip,(.265,.265,.265),fur,leg['names'][0])
    sphere_part(leg['label']+' elbow blend',elbow,(.198,.198,.198),fur,leg['names'][1])
    paw_bone=leg['names'][2]; tangent=(toe-foot).normalized()
    sphere_part(leg['label']+' soft paw',foot,(.22,.24,.135),fur,paw_bone,tangent)
    for j in [-1,0,1]:
        pos=foot+tangent*.083+Vector((j*.059,0,0))
        sphere_part(leg['label']+' toe',pos,(.085,.11,.108),cream,paw_bone,tangent)
    # Small fabric wrist band follows the lower leg rather than staying in midair.
    ankle=foot.lerp(elbow,.18)
    sphere_part(leg['label']+' wrist band',ankle,(.172,.085,.172),leather,leg['names'][1],(foot-elbow).normalized())

scene.frame_start=1; scene.frame_end=25; scene.render.fps=30; scene.name='Run_On_Orb'
wind=[o for o in collection.objects if o.name.startswith(('FurWind','EarWind'))]
rest=motion.location.copy()
# Contact phase sweeps backward along the curved sphere; recovery swings forward above it.
def stride(u,front,side):
    stance=.58; start=-.60 if front else .00; sweep=.45
    if u<stance:
        phi=start+sweep*u/stance; lift=0
    else:
        t=(u-stance)/(1-stance)
        ease=t*t*(3-2*t)
        phi=start+sweep*(1-ease); lift=.165*math.sin(math.pi*t)**1.3
    return foot_at(phi,lift,side)

contacts=[]
for frame in range(1,26):
    cycle=(frame-1)/24; angle=cycle*math.pi*2
    motion.location=rest+Vector((0,0,.035*(1-math.cos(angle*2))))
    motion.rotation_euler=(.014*math.sin(angle*2),.018*math.sin(angle),.018*math.sin(angle))
    motion.keyframe_insert('location',frame=frame); motion.keyframe_insert('rotation_euler',frame=frame)
    bpy.context.view_layer.update()
    world=rig.matrix_world.copy(); inv=world.inverted()
    for leg in legs:
        u=(cycle+leg['phase'])%1
        paw,tangent=stride(u,leg['front'],leg['side'])
        local_paw=inv@paw
        knee=solve_elbow(leg['hip'],local_paw,leg['l1'],leg['l2'],(0,1 if leg['front'] else -1,0))
        pts=[leg['hip'],knee,local_paw,inv@(paw+tangent*.17)]
        for i,name in enumerate(leg['names']):
            pb=rig.pose.bones[name]
            direction=(pts[i+1]-pts[i]).normalized()
            transform=direction.to_track_quat('Y','Z').to_matrix().to_4x4(); transform.translation=pts[i]
            pb.matrix=transform
            bpy.context.view_layer.update()
            pb.rotation_mode='QUATERNION'
            pb.keyframe_insert('location',frame=frame); pb.keyframe_insert('rotation_quaternion',frame=frame); pb.keyframe_insert('scale',frame=frame)
        if u<.58: contacts.append(abs((paw-Vector((0,0,CZ))).length-(R+.067)))
    for i,b in enumerate(tailrig.pose.bones):
        b.rotation_mode='XYZ'; b.rotation_euler=(.032*math.sin(angle-i*.48),0,(.025+i*.008)*math.sin(angle-i*.48))
        b.keyframe_insert('rotation_euler',frame=frame)
    for i,ctrl in enumerate(wind):
        ctrl.rotation_euler=(.038*math.sin(angle+i*.5),.018*math.sin(angle+i*.5),.025*math.sin(angle+i*.5+.5))
        ctrl.keyframe_insert('rotation_euler',frame=frame)
assert max(contacts)<.00001, 'Paw targets must stay on the sphere during stance.'
rig['description']='Four articulated legs with curved-surface paw targets; diagonal gait. Twelve leg bones.'
rider['animation_notes']='Run_On_Orb: 0.8-second loop. Independent RiderRoot jump/flip control remains unkeyed. Old cruising files are preserved.'
scene.frame_set(1)
scene.camera.location=(5,-7.5,3.7); aim(scene.camera,(0,.48,1.75)); scene.camera.data.ortho_scale=4.8
scene.render.resolution_x=1200; scene.render.resolution_y=1050; scene.render.resolution_percentage=100
scene.cycles.samples=32; scene.render.filepath=str(OUT/'fox-running-preview.png')
asset=bpy.data.collections['Detailed fox and orb']; asset.name='Running fox and orb'
bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'fox-running.blend'))
sys.path.insert(0,str(OUT))
from merge_cruise_clip import merge_cruise_clip
for filename,objects in [('fox-running.glb',list(asset.all_objects)),('fox-running-rider.glb',list(collection.objects))]:
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/filename),use_selection=True,export_apply=True,export_animation_mode='SCENE',export_force_sampling=True)
    merge_cruise_clip(OUT/filename)
    # Reuse the track merger but name this independent running clip correctly.
    path=OUT/filename; raw=path.read_bytes(); n,k=struct.unpack_from('<II',raw,12); g=json.loads(raw[20:20+n]); g['animations'][0]['name']='Run_On_Orb'
    encoded=json.dumps(g,separators=(',',':')).encode(); encoded+=b' '*((-len(encoded))%4); restbytes=raw[20+n:]
    path.write_bytes(struct.pack('<III',0x46546C67,2,20+len(encoded)+len(restbytes))+struct.pack('<II',len(encoded),k)+encoded+restbytes)
bpy.ops.render.render(write_still=True)
scene.cycles.samples=8; scene.render.resolution_x=720; scene.render.resolution_y=630
frames=OUT/'fox-run-frames'; frames.mkdir(exist_ok=True)
scene.render.filepath=str(frames/'frame-'); scene.frame_end=24; scene.frame_step=1
bpy.ops.render.render(animation=True)
