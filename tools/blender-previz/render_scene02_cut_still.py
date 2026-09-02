"""Create the full-script SCENE 2 (formerly CUT 2) room-layout still."""

import bpy
import json
import os
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


OUTFILE = os.environ["SCENE02_STILL_OUTFILE"]
BLEND_OUT = os.environ["SCENE02_BLEND_OUT"]
REPORT_OUT = os.environ["SCENE02_REPORT_OUT"]


def look_at(camera, target):
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = (
        Vector(target) - camera.location
    ).to_track_quat("-Z", "Y")


def hide_prefixes(prefixes):
    for obj in bpy.data.objects:
        if any(obj.name.startswith(prefix) for prefix in prefixes):
            obj.hide_render = True
            obj.hide_viewport = True


scene = bpy.context.scene
scene.frame_set(1)

# Only Believer B appears in this cut. The west chair is the camera position.
hide_prefixes(("Zannenin_", "BelieverF_", "Chair_Zannenin", "Chair_BelieverF"))

believer_b = bpy.data.objects["BelieverB_Root"]
believer_b.animation_data_clear()
believer_b.location = (1.40, 0.23, 0)
believer_b.rotation_mode = "XYZ"
believer_b.rotation_euler = (0, 0, -1.57079632679)

chair_b = bpy.data.objects["Chair_BelieverB_Root"]
chair_b.location = (1.76, 0.23, 0)
chair_b.rotation_mode = "XYZ"
chair_b.rotation_euler = (0, 0, -1.57079632679)

# Align the matte-charcoal laptop with Believer B and the chair.
laptop_base = bpy.data.objects["Laptop_Base"]
laptop_base.location = (1.00, 0.23, 0.86)
laptop_base.rotation_mode = "XYZ"
laptop_base.rotation_euler = (0, 0, 0)
laptop_lid = bpy.data.objects["Laptop_Lid_Exterior"]
laptop_lid.location = (1.10, 0.23, 1.08)
laptop_lid.rotation_mode = "XYZ"
laptop_lid.rotation_euler = (0, -0.17453292520, 0)

# Fit the complete door inside its authored 5-25% horizontal range.
door = bpy.data.objects["Door"]
door.location.y = 2.44
door.scale.y = 0.56

# Add the east-wall light switch between the north-side door and Believer B.
bpy.ops.mesh.primitive_cube_add(size=2, location=(3.86, 1.45, 1.40))
switch_plate = bpy.context.active_object
switch_plate.name = "Scene02_LightSwitch_Plate"
switch_plate.scale = (0.04, 0.13, 0.18)
switch_plate.color = (0.86, 0.85, 0.78, 1.0)
bpy.ops.mesh.primitive_cube_add(size=2, location=(3.81, 1.45, 1.40))
switch_toggle = bpy.context.active_object
switch_toggle.name = "Scene02_LightSwitch_Toggle"
switch_toggle.scale = (0.025, 0.055, 0.085)
switch_toggle.color = (0.42, 0.41, 0.38, 1.0)

# Perspective west-seat view. North (+Y) appears at screen left. Perspective
# keeps the foreground subject readable while fitting the complete east-wall door.
bpy.ops.object.camera_add(location=(-3.20, 0.44, 1.25))
camera = bpy.context.active_object
camera.name = "Camera_SCENE02_FormerCUT02"
camera.data.type = "PERSP"
camera.data.lens = 45
camera.data.sensor_width = 36
camera.data.clip_start = 0.05
camera.data.clip_end = 100
look_at(camera, (1.40, 0.44, 1.25))
scene.camera = camera


def screen_x_bounds(obj):
    points = [
        world_to_camera_view(scene, camera, obj.matrix_world @ Vector(corner))
        for corner in obj.bound_box
    ]
    return [round(min(point.x for point in points), 4), round(max(point.x for point in points), 4)]


bpy.context.view_layer.update()
door_x = screen_x_bounds(door)
switch_x = screen_x_bounds(switch_plate)
subject_x = screen_x_bounds(bpy.data.objects["BelieverB_Head"])
laptop_x = screen_x_bounds(laptop_lid)
switch_center = round(sum(switch_x) / 2, 4)
subject_center = round(sum(subject_x) / 2, 4)
laptop_center = round(sum(laptop_x) / 2, 4)
passed = (
    0.04 <= door_x[0] <= 0.06
    and 0.24 <= door_x[1] <= 0.26
    and 0.30 <= switch_center <= 0.34
    and 0.54 <= subject_center <= 0.58
    and 0.54 <= laptop_center <= 0.58
)

report = {
    "name": "full-script-scene02-former-cut02-still-v1",
    "passed": passed,
    "resolution": [1920, 1080],
    "camera": {
        "name": camera.name,
        "position": [-3.20, 0.44, 1.25],
        "view": "west seat toward east wall",
        "projection": "perspective",
        "lens_mm": 45,
    },
    "screen_x": {
        "door_bounds": door_x,
        "light_switch_center": switch_center,
        "believer_b_head_center": subject_center,
        "laptop_center": laptop_center,
    },
    "visible_characters": ["BelieverB"],
    "hidden_for_camera_position": ["Zannenin", "BelieverF"],
}
with open(REPORT_OUT, "w", encoding="utf-8", newline="\n") as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
if not passed:
    raise RuntimeError("SCENE 2 composition evaluation failed")

scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = OUTFILE
bpy.context.view_layer.update()

os.makedirs(os.path.dirname(BLEND_OUT), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
bpy.ops.render.render(write_still=True)

print("STILL=" + OUTFILE)
print("BLEND=" + BLEND_OUT)
print("REPORT=" + REPORT_OUT)
