"""Stream-owner celebration. Reads the running fox; writes only fox-celebration assets."""
import bpy, math, sys, json, struct
from pathlib import Path
from mathutils import Vector, Matrix
OUT=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(OUT/'fox-running.blend'))
scene=bpy.context.scene; scene.frame_set(1); bpy.context.view_layer.update()
rider=bpy.data.objects['RiderRoot']; motion=bpy.data.objects['CruiseMotion']
rig=bpy.data.objects['FoxRunRig']; tail=bpy.data.objects['FoxTailRig']
collection=bpy.data.collections['Rider']; asset=bpy.data.collections['Running fox and orb']
# Retain original action datablocks for inspection while the timeline previews the new clip.
for obj in collection.objects:
    if obj.animation_data and obj.animation_data.action:
        obj.animation_data.action.use_fake_user=True
    obj.animation_data_clear()
base_rider=rider.location.copy(); base_motion=motion.location.copy()
base_pose={b.name:b.matrix_basis.copy() for b in rig.pose.bones}
base_tail={b.name:b.rotation_euler.copy() for b in tail.pose.bones}
wind=[o for o in collection.objects if o.name.startswith(('EarWind','FurWind'))]
base_wind={o.name:o.rotation_euler.copy() for o in wind}

def elbow(hip,foot,a,b,hint):
    delta=foot-hip; d=delta.length; axis=delta/d
    q=(a*a-b*b+d*d)/(2*d); h=math.sqrt(max(0,a*a-q*q))
    bend=Vector(hint)-axis*axis.dot(Vector(hint)); bend.normalize()
    return hip+axis*q+bend*h

# Prepare a folded pose in the same rig; no replacement geometry or changed bindings.
for label,side,front in [('LF',-1,True),('RF',1,True),('LH',-1,False),('RH',1,False)]:
    hip=rig.data.bones[label+'_Upper'].head_local.copy()
    foot=Vector((side*.24,-.23 if front else .27,1.77 if front else 1.74))
    lengths=(.405,.385) if front else (.35,.34)
    knee=elbow(hip,foot,*lengths,(0,1 if front else -1,0))
    points=[hip,knee,foot,foot+Vector((0,-.17,0))]
    for i,suffix in enumerate(['Upper','Lower','Paw']):
        bone=rig.pose.bones[label+'_'+suffix]
        mat=(points[i+1]-points[i]).normalized().to_track_quat('Y','Z').to_matrix().to_4x4()
        mat.translation=points[i]; bone.matrix=mat; bpy.context.view_layer.update()
tucked={b.name:b.matrix_basis.copy() for b in rig.pose.bones}
for b in rig.pose.bones: b.matrix_basis=base_pose[b.name]

def smooth(x):
    x=max(0,min(1,x)); return x*x*(3-2*x)

scene.frame_start=1; scene.frame_end=35; scene.frame_step=1; scene.render.fps=30
scene.name='Stream_Tag_Backflip'
for frame in range(1,36):
    flight=(frame-5)/24
    airborne=0<flight<1
    lift=1.10*math.sin(math.pi*flight) if airborne else 0
    fold=smooth(flight/.20)*(1-smooth((flight-.79)/.21)) if airborne else 0
    turn=smooth((flight-.19)/.63)
    # Brief anticipation and landing compression; the sphere never moves.
    crouch=-.038*math.sin(math.pi*(frame-1)/4) if frame<5 else -.025*math.sin(math.pi*(frame-29)/6) if frame>29 else 0
    rider.location=base_rider+Vector((0,0,lift))
    rider.rotation_mode='XYZ'; rider.rotation_euler=(-2*math.pi*turn,0,0)
    rider.keyframe_insert('location',frame=frame); rider.keyframe_insert('rotation_euler',frame=frame)
    motion.location=base_motion+Vector((0,0,crouch)); motion.keyframe_insert('location',frame=frame)
    for bone in rig.pose.bones:
        a,qa,sa=base_pose[bone.name].decompose(); b,qb,sb=tucked[bone.name].decompose()
        bone.rotation_mode='QUATERNION'; bone.location=a.lerp(b,fold)
        bone.rotation_quaternion=qa.slerp(qb,fold); bone.scale=sa.lerp(sb,fold)
        for path in ['location','rotation_quaternion','scale']: bone.keyframe_insert(path,frame=frame)
    for i,bone in enumerate(tail.pose.bones):
        bone.rotation_mode='XYZ'; bone.rotation_euler=base_tail[bone.name]+Vector((.76*fold,0,.025*math.sin(flight*math.pi*2-i*.4)*fold))
        bone.keyframe_insert('rotation_euler',frame=frame)
    for i,obj in enumerate(wind):
        obj.rotation_euler=base_wind[obj.name]+Vector((.06*fold*math.sin(flight*math.pi*2+i),0,.035*fold))
        obj.keyframe_insert('rotation_euler',frame=frame)
scene.frame_set(1)
rider['celebration_trigger']='Play once on the stream owner when a different rider crashes into that owner\'s neon stream. Resume Run_On_Orb afterward.'
rider['animation_notes']='Stream_Tag_Backflip: 34/30 seconds, once. Independent orb stays still. Running clip is also included in the new GLB.'
scene.camera.location=(5,-7.5,4.3)
scene.camera.rotation_euler=(Vector((0,.4,2.15))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera.data.ortho_scale=5.3
scene.render.resolution_x=720; scene.render.resolution_y=720; scene.render.resolution_percentage=100
scene.cycles.samples=10
asset.name='Celebration fox and orb'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'fox-celebration.blend'))
sys.path.insert(0,str(OUT))
from merge_cruise_clip import merge_cruise_clip
for filename,objects in [('fox-celebration.glb',list(asset.all_objects)),('fox-celebration-rider.glb',list(collection.objects))]:
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/filename),use_selection=True,export_apply=True,export_animation_mode='SCENE',export_force_sampling=True)
    merge_cruise_clip(OUT/filename)
# Merge the existing running clip onto the same nodes, so the new asset can run and celebrate.
from combine_fox_clips import combine_fox_clips
combine_fox_clips(OUT/'fox-celebration.glb',OUT/'fox-running.glb')
combine_fox_clips(OUT/'fox-celebration-rider.glb',OUT/'fox-running-rider.glb')
frames=OUT/'fox-backflip-frames'; frames.mkdir(exist_ok=True)
scene.render.filepath=str(frames/'frame-'); scene.frame_end=35; scene.frame_step=2
bpy.ops.render.render(animation=True)
