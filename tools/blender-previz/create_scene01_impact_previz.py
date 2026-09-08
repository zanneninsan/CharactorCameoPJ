"""SCENE 01 impact-camera previz built from the shared meeting-room scene."""

import bpy
import json
import math
import os
from mathutils import Vector


FPS = 24
FRAMES = 168
F_CAMERA_MOVE = 78
F_EFFECT_ON = 83
F_CAMERA_STOP = 88
QC = os.environ.get("QC", "0") == "1"
OUT = os.environ["OUTDIR"]
BLEND_OUT = os.environ["BLEND_OUT"]
REPORT_OUT = os.environ["REPORT_OUT"]
PLAN_OUT = os.environ["PLAN_OUT"]
os.makedirs(OUT, exist_ok=True)

D = math.radians
C_EFFECT_DARK = (0.025, 0.018, 0.045)
C_EFFECT_GOLD = (0.95, 0.58, 0.055)
C_EFFECT_CREAM = (1.00, 0.88, 0.46)
C_EFFECT_RED = (0.52, 0.045, 0.075)


def set_color(obj, color):
    obj.color = (*color, 1.0)


def cube(name, loc, scale, color, parent=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=2, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    set_color(obj, color)
    if parent:
        obj.parent = parent
    bevel = obj.modifiers.new(name="Impact_Bevel", type="BEVEL")
    bevel.width = min(scale) * 0.18
    bevel.segments = 2
    return obj


def sphere(name, loc, scale, color, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    set_color(obj, color)
    if parent:
        obj.parent = parent
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def empty(name, loc=(0, 0, 0)):
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=loc)
    obj = bpy.context.active_object
    obj.name = name
    return obj


def look_rotation(loc, target):
    return (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


def key_object(obj, frame, loc=None, rot=None, scale=None):
    if loc is not None:
        obj.location = loc
        obj.keyframe_insert("location", frame=frame)
    if rot is not None:
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = rot
        obj.keyframe_insert("rotation_euler", frame=frame)
    if scale is not None:
        obj.scale = scale
        obj.keyframe_insert("scale", frame=frame)


def key_camera(camera, frame, loc, target, lens):
    camera.location = loc
    camera.rotation_mode = "XYZ"
    camera.rotation_euler = look_rotation(loc, target)
    camera.data.lens = lens
    camera.keyframe_insert("location", frame=frame)
    camera.keyframe_insert("rotation_euler", frame=frame)
    camera.data.keyframe_insert("lens", frame=frame)


def set_action_interpolation(obj, interpolation="BEZIER"):
    animation = getattr(obj, "animation_data", None)
    action = animation.action if animation else None
    if not action or not hasattr(action, "fcurves"):
        return
    for fcurve in action.fcurves:
        for point in fcurve.keyframe_points:
            point.interpolation = interpolation
            if interpolation == "BEZIER":
                point.handle_left_type = "AUTO_CLAMPED"
                point.handle_right_type = "AUTO_CLAMPED"


def key_visibility(objects, hidden_until, visible_from):
    preferences = bpy.context.preferences.edit
    previous_interpolation = preferences.keyframe_new_interpolation_type
    preferences.keyframe_new_interpolation_type = "CONSTANT"
    for obj in objects:
        obj.hide_render = True
        obj.hide_viewport = True
        obj.keyframe_insert("hide_render", frame=1)
        obj.keyframe_insert("hide_viewport", frame=1)
        obj.keyframe_insert("hide_render", frame=hidden_until)
        obj.keyframe_insert("hide_viewport", frame=hidden_until)
        obj.hide_render = False
        obj.hide_viewport = False
        obj.keyframe_insert("hide_render", frame=visible_from)
        obj.keyframe_insert("hide_viewport", frame=visible_from)
        obj.keyframe_insert("hide_render", frame=FRAMES)
        obj.keyframe_insert("hide_viewport", frame=FRAMES)
        set_action_interpolation(obj, "CONSTANT")
    preferences.keyframe_new_interpolation_type = previous_interpolation


scene = bpy.context.scene
bpy.context.preferences.edit.keyframe_new_interpolation_type = "BEZIER"
scene.frame_start = 1
scene.frame_end = FRAMES
scene.render.fps = FPS
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x = 960
scene.render.resolution_y = 540
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.display.shading.light = "STUDIO"
scene.display.shading.studio_light = "paint.sl"
scene.display.shading.color_type = "OBJECT"
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = "WORLD"
scene.display.shading.curvature_ridge_factor = 1.45
scene.display.shading.curvature_valley_factor = 0.95
scene.display.shading.show_specular_highlight = False
scene.display.shading.background_type = "VIEWPORT"
scene.display.shading.background_color = (0.055, 0.060, 0.075)
scene.view_settings.look = "AgX - Medium High Contrast"

# Disable the SCENE 5 cut markers; this is one continuous SCENE 01 camera.
for marker in scene.timeline_markers:
    marker.camera = None

zannenin = bpy.data.objects["Zannenin_Root"]
believer_b = bpy.data.objects["BelieverB_Root"]
believer_f = bpy.data.objects["BelieverF_Root"]
z_gesture = bpy.data.objects["Zannenin_RightGesture"]
for obj in (zannenin, believer_b, believer_f, z_gesture):
    obj.animation_data_clear()

# The other two characters remain seated and only recoil a fraction at impact.
for frame, pitch in ((1, 0), (77, 0), (88, -2.2), (96, -0.7), (168, -0.7)):
    key_object(believer_b, frame, loc=(1.40, 0.08, 0), rot=(D(pitch), 0, D(-128)))
for frame, pitch in ((1, 0), (77, 0), (88, -1.8), (96, -0.5), (168, -0.5)):
    key_object(believer_f, frame, loc=(-1.40, 0.16, 0), rot=(D(pitch), 0, D(138)))

# Zannenin launches upright early, performs continuously, then punches the title
# phrase with an enlarged right-arm gesture during the crash dolly.
for frame, height, pitch in (
    (1, 0.00, -11.0),
    (4, -0.025, -13.0),
    (10, 0.18, -4.0),
    (18, 0.35, 2.5),
    (30, 0.30, -1.0),
    (58, 0.34, 2.0),
    (77, 0.31, -3.0),
    (88, 0.40, 1.5),
    (112, 0.37, -1.0),
    (150, 0.41, 2.0),
    (160, 0.40, 1.0),
    (168, 0.40, 1.0),
):
    key_object(zannenin, frame, loc=(0, 2.40, height), rot=(D(pitch), 0, 0))

for frame, roll, pitch in (
    (1, -18, -3),
    (8, -9, -2),
    (18, 20, 1),
    (50, 30, -2),
    (77, 8, -6),
    (88, 62, 4),
    (120, 70, 2),
    (150, 78, 0),
    (160, 72, 0),
    (168, 72, 0),
):
    key_object(z_gesture, frame, rot=(D(pitch), D(-3), D(roll)))

for obj in (zannenin, believer_b, believer_f, z_gesture):
    set_action_interpolation(obj)

# Black-gold impact plate behind Zannenin. It is absent from the wide room shot,
# switches on only once the camera is already moving, and fills the close frame.
effect_root = empty("SCENE01_ImpactBackground_Root", (0, 3.70, 1.76))
effect_objects = []
effect_objects.append(cube("SCENE01_ImpactBackground_Base", (0, 0.02, 0), (5.2, 0.025, 3.3), C_EFFECT_DARK, effect_root))
effect_objects.append(sphere("SCENE01_ImpactBackground_Halo", (0, -0.015, 0.05), (1.58, 0.022, 1.58), C_EFFECT_RED, effect_root))
for index in range(24):
    angle = D(index * 15.0 + 7.5)
    radius = 2.18
    length = 4.6 if index % 2 == 0 else 3.8
    thickness = 0.095 if index % 3 == 0 else 0.052
    x_pos = math.cos(angle) * radius
    z_pos = math.sin(angle) * radius
    color = C_EFFECT_GOLD if index % 2 == 0 else C_EFFECT_CREAM
    effect_objects.append(
        cube(
            f"SCENE01_ImpactRay_{index + 1:02d}",
            (x_pos, -0.035, z_pos),
            (length * 0.5, 0.018, thickness),
            color,
            effect_root,
            rot=(0, -angle, 0),
        )
    )
key_visibility(effect_objects, F_EFFECT_ON - 1, F_EFFECT_ON)
key_object(effect_root, F_EFFECT_ON, scale=(0.82, 1.0, 0.82), rot=(0, D(-2.5), 0))
key_object(effect_root, 96, scale=(1.10, 1.0, 1.10), rot=(0, D(2.5), 0))
key_object(effect_root, 128, scale=(1.03, 1.0, 1.03), rot=(0, D(-1.5), 0))
key_object(effect_root, 168, scale=(1.08, 1.0, 1.08), rot=(0, D(1.5), 0))
set_action_interpolation(effect_root)

# Camera: readable opening master, then a 10-frame crash dolly and two-frame hit.
bpy.ops.object.camera_add(location=(0, -5.25, 2.28))
camera = bpy.context.active_object
camera.name = "Camera_SCENE01_ImpactDolly"
camera.data.type = "PERSP"
camera.data.sensor_width = 36.0
camera.data.clip_start = 0.05
camera.data.clip_end = 100
key_camera(camera, 1, (0, -5.25, 2.28), (0, 1.10, 1.12), 35.0)
key_camera(camera, F_CAMERA_MOVE - 1, (0, -5.25, 2.28), (0, 1.10, 1.12), 35.0)
key_camera(camera, 83, (0, -1.80, 2.02), (0, 2.05, 1.55), 43.0)
key_camera(camera, F_CAMERA_STOP, (0, -0.55, 1.95), (0, 2.42, 1.86), 50.0)
key_camera(camera, 89, (0.035, -0.56, 1.970), (0, 2.42, 1.86), 50.0)
key_camera(camera, 90, (-0.025, -0.55, 1.935), (0, 2.42, 1.86), 50.0)
key_camera(camera, 92, (0, -0.55, 1.95), (0, 2.42, 1.86), 50.0)
key_camera(camera, FRAMES, (0, -0.55, 1.95), (0, 2.42, 1.86), 50.0)
set_action_interpolation(camera)
set_action_interpolation(camera.data)
scene.camera = camera

report = {
    "name": "scene01-impact-camera-previz-v2",
    "passed": True,
    "duration_seconds": 7.0,
    "fps": FPS,
    "frames": FRAMES,
    "render_resolution": [960, 540],
    "camera": {
        "wide_hold_frames": [1, F_CAMERA_MOVE - 1],
        "crash_dolly_frames": [F_CAMERA_MOVE, F_CAMERA_STOP],
        "impact_jolt_frames": [89, 92],
        "close_hold_frames": [92, FRAMES],
        "start_lens_mm": 35.0,
        "end_lens_mm": 50.0,
    },
    "effect_background": {
        "starts_frame": F_EFFECT_ON,
        "palette": "black, gold, cream, deep red",
        "radial_rays": 24,
        "visible_only_during_close": True,
    },
    "performance": {
        "zannenin": "fast rise, continuous high-energy body bounce, large right-arm declaration",
        "believer_b": "seated silent reaction",
        "believer_f": "seated silent reaction",
    },
    "fixed_layout": {
        "characters": 3,
        "zannenin": "north head position",
        "believer_b": "east seat with one laptop",
        "believer_f": "west window-side seat",
        "door_handle": "left side from room interior front view",
    },
    "qc_frames": [1, 18, 77, 83, 88, 120, 160, 168],
}
with open(REPORT_OUT, "w", encoding="utf-8", newline="\n") as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
    handle.write("\n")

plan = """# SCENE 01 impact-camera previz v2

- 00:00.00–00:03.21: 三人の正面ワイド。残念院さんは冒頭から素早く立ち上がり、高いテンションで全身を使って宣言する。
- 00:03.25–00:03.67: 10フレームの急速な直線ドリーイン。カメラ軸は変えず、残念院さんの胸上まで一気に寄る。
- 00:03.42: 寄りの途中で黒・金・クリーム・深紅の放射状効果背景へ切り替える。
- 00:03.67–00:03.83: 到達時に2フレームの小さなインパクト揺れを入れ、すぐ停止する。
- 00:03.83–00:07.00: 残念院さんの寄りを固定。右手を大きく掲げ、効果背景だけを緩く脈動させる。

キャラクター、座席、PC、窓、扉、ドアノブ、机の配置は共有会議室モデルから変更しない。プレビズのCG外観と効果背景の具体的な線を完成画へ転写せず、演技、カメラ時刻、画面占有率、背景切替の役割だけを参照する。
"""
with open(PLAN_OUT, "w", encoding="utf-8", newline="\n") as handle:
    handle.write(plan)

bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)

if QC:
    for index, frame in enumerate(report["qc_frames"], 1):
        scene.frame_set(frame)
        scene.render.filepath = os.path.join(OUT, f"qc_{index:04d}.png")
        bpy.ops.render.render(write_still=True)
else:
    scene.render.filepath = os.path.join(OUT, "frames", "frame_")
    os.makedirs(os.path.dirname(scene.render.filepath), exist_ok=True)
    bpy.ops.render.render(animation=True)
