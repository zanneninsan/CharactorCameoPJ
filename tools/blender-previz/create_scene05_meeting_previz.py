"""Seven-second, two-shot Blender previz for meeting SCENE 5."""

import bpy
import json
import math
import os
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


FPS = 24
FRAMES = 168
F_SHOT_2 = 90  # 3.70 seconds lands between frames 89 and 90 at 24 fps.
QC = os.environ.get("QC", "0") == "1"
OUT = os.environ["OUTDIR"]
BLEND_OUT = os.environ["BLEND_OUT"]
REPORT_OUT = os.environ["REPORT_OUT"]
PLACEMENT_OUT = os.environ["PLACEMENT_OUT"]
os.makedirs(OUT, exist_ok=True)

D = math.radians

# Workbench colors distinguish blocking roles; they are not appearance references.
C_WALL = (0.58, 0.54, 0.43)
C_FLOOR = (0.37, 0.46, 0.39)
C_TRIM = (0.19, 0.17, 0.14)
C_TABLE = (0.34, 0.22, 0.13)
C_CHAIR = (0.22, 0.24, 0.26)
C_WINDOW = (0.65, 0.77, 0.80)
C_BOARD = (0.43, 0.31, 0.19)
C_BLACK = (0.055, 0.060, 0.070)
C_CHARCOAL = (0.10, 0.11, 0.12)
C_GOLD = (0.80, 0.55, 0.18)
C_CREAM = (0.85, 0.82, 0.72)
C_SKIN = (0.88, 0.70, 0.65)
C_WHITE = (0.90, 0.92, 0.93)
C_PINK = (0.49, 0.33, 0.37)
C_BLUE = (0.42, 0.58, 0.67)
C_OLIVE = (0.30, 0.31, 0.20)
C_AMBER = (0.82, 0.48, 0.08)
C_SILVER = (0.83, 0.88, 0.92)
C_LAVENDER = (0.59, 0.50, 0.73)


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def smoothstep(value):
    value = clamp(value)
    return value * value * (3.0 - 2.0 * value)


def lerp(a, b, t):
    return a + (b - a) * t


def set_color(obj, color):
    obj.color = (*color, 1.0)


def empty(name, loc=(0, 0, 0), parent=None):
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.empty_display_size = 0.08
    if parent:
        obj.parent = parent
    return obj


def cube(name, loc, scale, color, parent=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    set_color(obj, color)
    if parent:
        obj.parent = parent
    return obj


def sphere(name, loc, scale, color, parent=None, segments=16, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, location=loc
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    set_color(obj, color)
    if parent:
        obj.parent = parent
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def cylinder_between(name, p0, p1, radius, color, parent=None, vertices=12):
    p0, p1 = Vector(p0), Vector(p1)
    vector = p1 - p0
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=max(vector.length, 0.001),
        location=(p0 + p1) / 2,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(
        vector.normalized()
    )
    set_color(obj, color)
    if parent:
        obj.parent = parent
    return obj


def cone_between(name, p0, p1, r0, r1, color, parent=None, vertices=12):
    p0, p1 = Vector(p0), Vector(p1)
    vector = p1 - p0
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=r0,
        radius2=r1,
        depth=max(vector.length, 0.001),
        location=(p0 + p1) / 2,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(
        vector.normalized()
    )
    set_color(obj, color)
    if parent:
        obj.parent = parent
    return obj


def curve_tube(name, points, radius, color, parent=None):
    data = bpy.data.curves.new(name + "_Curve", "CURVE")
    data.dimensions = "3D"
    data.bevel_depth = radius
    data.bevel_resolution = 2
    spline = data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    set_color(obj, color)
    if parent:
        obj.parent = parent
    return obj


def look_at(camera, target):
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = (
        Vector(target) - camera.location
    ).to_track_quat("-Z", "Y")


def key_transform(obj, frame, loc=None, rot=None):
    if loc is not None:
        obj.location = loc
        obj.keyframe_insert("location", frame=frame)
    if rot is not None:
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = rot
        obj.keyframe_insert("rotation_euler", frame=frame)


# Scene and renderer.
bpy.ops.wm.read_factory_settings(use_empty=True)
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
scene.display.shading.curvature_ridge_factor = 1.3
scene.display.shading.curvature_valley_factor = 0.8
scene.display.shading.show_specular_highlight = False
scene.display.shading.background_type = "VIEWPORT"
scene.display.shading.background_color = (0.12, 0.12, 0.11)
scene.view_settings.look = "AgX - Medium High Contrast"

# Room topology: north is +Y, east is +X.
cube("Floor", (0, 0, -0.06), (4.2, 4.3, 0.06), C_FLOOR)
cube("North_Wall", (0, 4.05, 1.55), (4.2, 0.08, 1.55), C_WALL)
cube("West_Wall", (-4.05, 0, 1.55), (0.08, 4.1, 1.55), C_WALL)
cube("East_Wall", (4.05, 0, 1.55), (0.08, 4.1, 1.55), C_WALL)
cube("Ceiling", (0, 0, 3.12), (4.2, 4.3, 0.06), (0.40, 0.38, 0.33))

windows = []
for index, y_pos in enumerate((-1.55, 1.30), 1):
    windows.append(
        cube(
            f"Window_{index}",
            (-3.96, y_pos, 1.65),
            (0.035, 0.72, 0.72),
            C_WINDOW,
        )
    )
    cube(
        f"Window_Frame_{index}_Vertical",
        (-3.92, y_pos, 1.65),
        (0.035, 0.035, 0.76),
        C_TRIM,
    )
    cube(
        f"Window_Frame_{index}_Horizontal",
        (-3.92, y_pos, 1.65),
        (0.035, 0.76, 0.035),
        C_TRIM,
    )

door = cube(
    "Door", (3.96, 2.55, 1.18), (0.05, 0.72, 1.18), (0.27, 0.17, 0.10)
)
cube("Door_Handle", (3.86, 2.05, 1.18), (0.06, 0.04, 0.04), C_GOLD)
for index, y_pos in enumerate((-1.15, 1.30), 1):
    cube(
        f"Fluorescent_{index}",
        (0, y_pos, 3.02),
        (1.02, 0.16, 0.055),
        (0.92, 0.91, 0.79),
    )

# North-wall banner and an upright proxy of the official diamond emblem.
cube("Notice_Board", (0, 3.94, 2.15), (1.35, 0.035, 0.62), C_BOARD)
cube("Black_Banner", (0, 3.86, 2.15), (1.05, 0.025, 0.48), C_BLACK)
cube(
    "Emblem_Outer_Diamond",
    (0, 3.81, 2.15),
    (0.28, 0.025, 0.28),
    C_GOLD,
    rot=(0, D(45), 0),
)
cube(
    "Emblem_Inner_Diamond",
    (0, 3.77, 2.15),
    (0.21, 0.022, 0.21),
    C_BLACK,
    rot=(0, D(45), 0),
)
cube("Emblem_Mitsu_V", (0, 3.73, 2.15), (0.025, 0.018, 0.15), C_GOLD)
cube("Emblem_Mitsu_H1", (0, 3.73, 2.19), (0.13, 0.018, 0.022), C_GOLD)
cube("Emblem_Mitsu_H2", (0, 3.73, 2.11), (0.13, 0.018, 0.022), C_GOLD)

# One continuous long table; the underframe does not split the visible tabletop.
tabletop = cube("Table_ContinuousTop", (0, 0.35, 0.78), (1.42, 2.18, 0.055), C_TABLE)
cube("Table_South_Edge", (0, -1.79, 0.73), (1.42, 0.035, 0.10), C_TRIM)
for x_pos in (-1.12, 1.12):
    for y_pos in (-1.15, 1.85):
        cylinder_between(
            f"Table_Leg_{x_pos:+.2f}_{y_pos:+.2f}",
            (x_pos, y_pos, 0.04),
            (x_pos, y_pos, 0.72),
            0.028,
            C_TRIM,
        )


def build_chair(name, loc, yaw, executive=False):
    root = empty(name + "_Root", loc)
    seat_color = C_CHARCOAL if executive else C_CHAIR
    cube(name + "_Seat", (0, 0, 0.48), (0.36, 0.36, 0.05), seat_color, root)
    cube(
        name + "_Back",
        (0, 0.27, 1.12 if executive else 0.87),
        (0.55 if executive else 0.34, 0.06, 0.67 if executive else 0.42),
        seat_color,
        root,
    )
    if executive:
        cube(name + "_LeftArm", (-0.38, 0.02, 0.72), (0.05, 0.28, 0.04), C_BLACK, root)
        cube(name + "_RightArm", (0.38, 0.02, 0.72), (0.05, 0.28, 0.04), C_BLACK, root)
    for x_pos in (-0.26, 0.26):
        for y_pos in (-0.22, 0.22):
            cylinder_between(
                f"{name}_Leg_{x_pos}_{y_pos}",
                (x_pos, y_pos, 0.03),
                (x_pos, y_pos, 0.44),
                0.035 if executive else 0.025,
                C_TRIM,
                root,
            )
    root.rotation_euler.z = yaw
    return root


chair_z = build_chair("Chair_Zannenin", (-0.55, 2.74, 0), 0, True)
chair_b = build_chair("Chair_BelieverB", (1.76, 0.08, 0), D(-128))
chair_f = build_chair("Chair_BelieverF", (-1.76, 0.16, 0), D(138))

# The only tabletop prop: Believer B's matte charcoal laptop, screen facing east/+X.
laptop_base = cube(
    "Laptop_Base",
    (1.00, 0.42, 0.86),
    (0.34, 0.28, 0.025),
    C_CHARCOAL,
    rot=(0, 0, D(-40)),
)
laptop_lid = cube(
    "Laptop_Lid_Exterior",
    (1.10, 0.34, 1.08),
    (0.025, 0.28, 0.24),
    C_CHARCOAL,
    rot=(0, D(-10), D(-40)),
)


def build_character(name, hair_color, eye_color, hair_style, cape=True):
    root = empty(name + "_Root")
    cone_between(name + "_Torso", (0, 0, 0.78), (0, 0, 1.28), 0.25, 0.21, C_BLACK, root)
    cone_between(name + "_Skirt", (0, 0.02, 0.48), (0, 0, 0.91), 0.35, 0.24, C_BLACK, root)
    if cape:
        cone_between(name + "_Cape", (0, 0.04, 1.00), (0, 0.02, 1.30), 0.33, 0.27, C_CREAM, root, 16)
    cylinder_between(name + "_Neck", (0, 0, 1.25), (0, 0, 1.39), 0.075, C_SKIN, root)
    sphere(name + "_Head", (0, -0.025, 1.58), (0.20, 0.17, 0.24), C_SKIN, root, 20, 10)
    sphere(name + "_HairCap", (0, 0.025, 1.63), (0.225, 0.19, 0.25), hair_color, root, 20, 10)
    sphere(name + "_FacePatch", (0, -0.174, 1.57), (0.17, 0.026, 0.19), C_SKIN, root, 16, 8)
    for side in (-1, 1):
        sphere(f"{name}_Eye_{side:+d}", (0.068 * side, -0.205, 1.60), (0.040, 0.012, 0.032), eye_color, root, 12, 6)
    cube(name + "_ChestGold", (0, -0.205, 1.17), (0.055, 0.012, 0.055), C_GOLD, root, rot=(0, D(45), 0))
    for side in (-1, 1):
        cylinder_between(f"{name}_Thigh_{side:+d}", (0.13 * side, 0, 0.60), (0.15 * side, -0.26, 0.43), 0.075, C_BLACK, root)
        cylinder_between(f"{name}_Shin_{side:+d}", (0.15 * side, -0.26, 0.43), (0.15 * side, -0.33, 0.08), 0.06, C_BLACK, root)
    if hair_style == "braid":
        for index in range(6):
            sphere(f"{name}_Braid_{index}", (0.20, -0.10, 1.46 - index * 0.13), (0.075, 0.055, 0.085), hair_color, root, 10, 5)
        for index in range(2):
            cube(f"{name}_Hairpin_{index}", (-0.12, -0.19, 1.73 - index * 0.035), (0.055, 0.012, 0.009), C_GOLD, root)
    elif hair_style == "twintail":
        for side in (-1, 1):
            sphere(f"{name}_Tie_{side:+d}", (0.22 * side, 0.02, 1.65), (0.06, 0.055, 0.06), C_BLACK, root, 10, 5)
            curve_tube(f"{name}_TwinTail_{side:+d}", [(0.22 * side, 0.02, 1.65), (0.30 * side, 0.06, 1.42), (0.29 * side, 0.08, 1.12), (0.27 * side, 0.09, 0.86)], 0.055, hair_color, root)
    elif hair_style == "bob":
        for side in (-1, 1):
            sphere(f"{name}_Bob_{side:+d}", (0.16 * side, -0.005, 1.52), (0.10, 0.13, 0.18), hair_color, root, 12, 6)
        sphere(name + "_WhiteFlower", (0.17, -0.17, 1.72), (0.09, 0.025, 0.09), C_WHITE, root, 12, 6)
    return root


believer_b = build_character("BelieverB", C_PINK, C_BLUE, "braid", True)
zannenin = build_character("Zannenin", C_SILVER, C_LAVENDER, "twintail", False)
believer_f = build_character("BelieverF", C_OLIVE, C_AMBER, "bob", True)

believer_b.location = (1.40, 0.08, 0)
believer_b.rotation_euler = (0, 0, D(-128))
zannenin.location = (0, 2.40, 0)
zannenin.rotation_euler = (0, 0, 0)
believer_f.location = (-1.40, 0.16, 0)
believer_f.rotation_euler = (0, 0, D(138))

# Believer B rests both hands near the laptop and makes only a restrained dry reaction.
for side in (-1, 1):
    cylinder_between(f"BelieverB_UpperArm_{side:+d}", (0.22 * side, 0, 1.18), (0.30 * side, -0.05, 0.97), 0.065, C_BLACK, believer_b)
    cylinder_between(f"BelieverB_Forearm_{side:+d}", (0.30 * side, -0.05, 0.97), (0.18 * side, -0.30, 0.86), 0.052, C_BLACK, believer_b)
    sphere(f"BelieverB_Hand_{side:+d}", (0.18 * side, -0.30, 0.86), (0.065, 0.05, 0.075), C_SKIN, believer_b, 12, 6)

# Zannenin's left hand rests; the right hand is a separate gesture root.
cylinder_between("Zannenin_LeftUpperArm", (-0.22, 0, 1.18), (-0.30, -0.04, 0.98), 0.065, C_BLACK, zannenin)
cylinder_between("Zannenin_LeftForearm", (-0.30, -0.04, 0.98), (-0.20, -0.27, 0.86), 0.052, C_BLACK, zannenin)
sphere("Zannenin_LeftHand", (-0.20, -0.27, 0.86), (0.065, 0.05, 0.075), C_SKIN, zannenin, 12, 6)
z_gesture = empty("Zannenin_RightGesture", (0.22, 0, 1.18), zannenin)
cylinder_between("Zannenin_RightUpperArm", (0, 0, 0), (0.15, -0.03, 0.18), 0.065, C_BLACK, z_gesture)
cylinder_between("Zannenin_RightForearm", (0.15, -0.03, 0.18), (0.12, -0.08, 0.46), 0.052, C_BLACK, z_gesture)
sphere("Zannenin_RightHand", (0.12, -0.08, 0.51), (0.075, 0.045, 0.09), C_SKIN, z_gesture, 12, 6)

# Believer F is physically present at the west seat but remains outside both shots.
for side in (-1, 1):
    cylinder_between(f"BelieverF_Arm_{side:+d}", (0.22 * side, 0, 1.18), (0.24 * side, -0.20, 0.88), 0.060, C_BLACK, believer_f)

# Restrained performance: B settles after speaking; Z rises slightly and holds the hand.
b_base = Vector(believer_b.location)
for frame, pitch in ((1, 0), (9, 0), (36, -1.5), (55, 1.0), (86, -1.0), (89, -1.0), (168, -1.0)):
    key_transform(believer_b, frame, loc=b_base, rot=(D(pitch), 0, D(-128)))

z_base = Vector(zannenin.location)
for frame, height, pitch in ((1, 0, 0), (89, 0, 0), (90, 0.10, -1), (96, 0.23, -3), (150, 0.23, -3), (168, 0.23, -3)):
    key_transform(zannenin, frame, loc=z_base + Vector((0, 0, height)), rot=(D(pitch), 0, 0))
for frame, roll in ((1, -8), (89, -8), (90, -5), (96, 2), (150, 2), (168, 2)):
    key_transform(z_gesture, frame, rot=(0, D(-3), D(roll)))

f_base = Vector(believer_f.location)
for frame in (1, FRAMES):
    key_transform(believer_f, frame, loc=f_base, rot=(0, 0, D(138)))


def build_ortho_camera(name, loc, target, ortho_scale, shift_x=0.0, shift_y=0.0):
    bpy.ops.object.camera_add(location=loc)
    camera = bpy.context.active_object
    camera.name = name
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    camera.data.shift_x = shift_x
    camera.data.shift_y = shift_y
    camera.data.clip_start = 0.05
    camera.data.clip_end = 100
    look_at(camera, target)
    return camera


camera_shot1 = build_ortho_camera(
    "Camera_SHOT1_BelieverB",
    (0.15, 1.10, 1.58),
    (1.38, 0.06, 1.26),
    2.30,
    shift_x=0.00,
    shift_y=0.02,
)
camera_shot2 = build_ortho_camera(
    "Camera_SHOT2_Zannenin",
    (0.25, 0.55, 1.58),
    (0, 2.43, 1.90),
    3.15,
    shift_x=0.00,
    shift_y=0.02,
)

# SHOT 1 has only the specified 4% planar push. Camera angle and occlusion stay fixed.
camera_shot1.data.ortho_scale = 2.30
camera_shot1.data.keyframe_insert("ortho_scale", frame=1)
camera_shot1.data.keyframe_insert("ortho_scale", frame=9)
camera_shot1.data.ortho_scale = 2.208
camera_shot1.data.keyframe_insert("ortho_scale", frame=87)
camera_shot1.data.keyframe_insert("ortho_scale", frame=89)

marker1 = scene.timeline_markers.new("SHOT_1", frame=1)
marker1.camera = camera_shot1
marker2 = scene.timeline_markers.new("SHOT_2_HARD_CUT", frame=F_SHOT_2)
marker2.camera = camera_shot2
scene.camera = camera_shot1


def side_of_line(point, a=Vector((1.40, 0.08)), b=Vector((0, 2.40))):
    point = Vector((point[0], point[1]))
    return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)


def object_in_frame(obj, camera, frame):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    coordinates = [world_to_camera_view(scene, camera, obj.matrix_world @ Vector(corner)) for corner in obj.bound_box]
    visible = [co for co in coordinates if co.z > 0]
    if not visible:
        return False
    min_x, max_x = min(co.x for co in visible), max(co.x for co in visible)
    min_y, max_y = min(co.y for co in visible), max(co.y for co in visible)
    return max_x >= 0 and min_x <= 1 and max_y >= 0 and min_y <= 1


def object_fully_in_frame(obj, camera, frame, margin=0.01):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    coordinates = [world_to_camera_view(scene, camera, obj.matrix_world @ Vector(corner)) for corner in obj.bound_box]
    return all(
        coordinate.z > 0
        and margin <= coordinate.x <= 1 - margin
        and margin <= coordinate.y <= 1 - margin
        for coordinate in coordinates
    )


def prefix_in_frame(prefix, camera, frame):
    core_tokens = (
        "_Head",
        "_FacePatch",
        "_Torso",
        "_Skirt",
        "_Cape",
        "_HairCap",
        "_Bob_",
        "_Braid_",
        "_Tie_",
        "_TwinTail_",
    )
    return any(
        object_in_frame(obj, camera, frame)
        for obj in bpy.data.objects
        if obj.name.startswith(prefix)
        and obj.type in {"MESH", "CURVE"}
        and any(token in obj.name for token in core_tokens)
    )


def point_screen(camera, frame, world_point):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    coordinate = world_to_camera_view(scene, camera, Vector(world_point))
    return [round(coordinate.x, 4), round(coordinate.y, 4), round(coordinate.z, 4)]


camera_side_signs = [
    side_of_line(camera_shot1.location),
    side_of_line(camera_shot2.location),
]
opening_visibility = {
    "shot1_start": {
        "windows": [object_in_frame(window, camera_shot1, 1) for window in windows],
        "door": object_in_frame(door, camera_shot1, 1),
    },
    "shot1_end": {
        "windows": [object_in_frame(window, camera_shot1, 89) for window in windows],
        "door": object_in_frame(door, camera_shot1, 89),
    },
    "shot2_start": {
        "windows": [object_in_frame(window, camera_shot2, 90) for window in windows],
        "door": object_in_frame(door, camera_shot2, 90),
    },
    "shot2_end": {
        "windows": [object_in_frame(window, camera_shot2, 168) for window in windows],
        "door": object_in_frame(door, camera_shot2, 168),
    },
}
openings_out_of_frame = not any(
    shot["door"] or any(shot["windows"]) for shot in opening_visibility.values()
)
shot_visibility = {
    "shot1": {
        "BelieverB": prefix_in_frame("BelieverB_", camera_shot1, 48),
        "Zannenin": prefix_in_frame("Zannenin_", camera_shot1, 48),
        "BelieverF": prefix_in_frame("BelieverF_", camera_shot1, 48),
        "laptop": object_in_frame(laptop_lid, camera_shot1, 48),
        "laptop_fully_framed": object_fully_in_frame(laptop_lid, camera_shot1, 48) and object_fully_in_frame(laptop_base, camera_shot1, 48),
    },
    "shot2": {
        "BelieverB": prefix_in_frame("BelieverB_", camera_shot2, 120),
        "Zannenin": prefix_in_frame("Zannenin_", camera_shot2, 120),
        "BelieverF": prefix_in_frame("BelieverF_", camera_shot2, 120),
        "laptop": object_in_frame(laptop_lid, camera_shot2, 120),
        "emblem_fully_framed": object_fully_in_frame(bpy.data.objects["Emblem_Outer_Diamond"], camera_shot2, 120),
    },
}
shot1_axis_delta = abs(
    point_screen(camera_shot1, 48, (1.40, 0.08, 1.58))[0]
    - point_screen(camera_shot1, 48, (1.06, 0.38, 1.02))[0]
)
subjects_isolated = (
    shot_visibility["shot1"]["BelieverB"]
    and not shot_visibility["shot1"]["Zannenin"]
    and not shot_visibility["shot1"]["BelieverF"]
    and shot_visibility["shot1"]["laptop"]
    and shot_visibility["shot1"]["laptop_fully_framed"]
    and shot1_axis_delta <= 0.04
    and shot_visibility["shot2"]["Zannenin"]
    and not shot_visibility["shot2"]["BelieverB"]
    and not shot_visibility["shot2"]["BelieverF"]
    and not shot_visibility["shot2"]["laptop"]
    and shot_visibility["shot2"]["emblem_fully_framed"]
)

# Save the reproducible scene before rendering.
os.makedirs(os.path.dirname(BLEND_OUT), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)

report = {
    "name": "pilot-opening-meeting-scene05-previz-v1-2d-camera",
    "passed": all(value > 0 for value in camera_side_signs) and openings_out_of_frame and subjects_isolated,
    "duration_seconds": 7.0,
    "fps": FPS,
    "frames": FRAMES,
    "hard_cut": {"frame": F_SHOT_2, "time_seconds": 3.70},
    "cameras": [
        {
            "name": camera_shot1.name,
            "projection": "orthographic fixed angle",
            "shot": "Believer B bust shot",
            "ortho_scale_start": 2.30,
            "ortho_scale_end": 2.208,
            "push_percent": 4.0,
        },
        {
            "name": camera_shot2.name,
            "projection": "orthographic fixed angle",
            "shot": "Zannenin waist-up medium shot",
            "ortho_scale": 3.15,
            "movement": "fixed",
        },
    ],
    "placement": {
        "Zannenin": {"seat": "north head executive chair", "world_xy": [0, 2.40]},
        "BelieverB": {"seat": "east long-side folding chair", "world_xy": [1.40, 0.08]},
        "BelieverF": {"seat": "west/window-side folding chair", "world_xy": [-1.40, 0.16], "visibility": "outside both shots"},
    },
    "fixed_counts": {
        "characters_in_room": 3,
        "visible_characters_per_shot": [1, 1],
        "continuous_tables": 1,
        "executive_chairs": 1,
        "folding_chairs": 2,
        "laptops": 1,
        "windows": 2,
        "doors": 1,
        "fluorescent_lights": 2,
        "north_wall_emblems": 1,
    },
    "laptop": {
        "owner": "BelieverB",
        "world_xyz": [1.00, 0.42, 0.86],
        "screen_faces": "southeast toward Believer B",
        "material_color": "matte charcoal gray",
        "visible_shot1": object_in_frame(laptop_lid, camera_shot1, 48),
        "visible_shot2": object_in_frame(laptop_lid, camera_shot2, 120),
        "shot1_center_axis_delta": round(shot1_axis_delta, 4),
    },
    "dialogue_axis": "BelieverB <-> Zannenin",
    "camera_side_signs": [round(value, 3) for value in camera_side_signs],
    "shot_visibility": shot_visibility,
    "subjects_isolated": subjects_isolated,
    "openings_in_frame": opening_visibility,
    "openings_out_of_frame": openings_out_of_frame,
    "screen_points": {
        "shot1_believer_b_head": point_screen(camera_shot1, 48, (1.40, 0.08, 1.58)),
        "shot1_laptop": point_screen(camera_shot1, 48, (1.06, 0.38, 1.02)),
        "shot2_zannenin_head": point_screen(camera_shot2, 120, (0, 2.40, 1.81)),
        "shot2_emblem": point_screen(camera_shot2, 120, (0, 3.77, 2.15)),
    },
    "qc_frames": [1, 9, 48, 89, 90, 96, 120, 168],
    "visual_qc_required": True,
}
with open(REPORT_OUT, "w", encoding="utf-8", newline="\n") as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
    handle.write("\n")

placement = """# SCENE 5：配置・カメラ決定

この文書はBlenderプレビズに基づく今回限りの演出指定であり、キャラクターの公式設定ではありません。

## 部屋と座席

```text
                         北壁
             掲示板／黒い垂れ幕／エンブレム

                  [残念院さん・信者Z]
                    黒い社長椅子
                         ▲
                         │
 西壁・窓2  [信者F] ◀ 一枚の長机 ▶ [信者B]  東壁・扉1
              パイプ椅子       PC     パイプ椅子
                         │
                         南
```

- 長机の長軸は南北。天板は継ぎ目のない一枚だけを表示する。
- 残念院さんは北側短辺の上座、信者Bは東側長辺、信者Fは西側長辺に固定する。
- ノートPCは信者B側の机上に1台だけ置き、画面を信者Bへ正対させる。色はつや消しチャコールグレーで固定する。
- 西壁に窓2つ、東壁北寄りに扉1つ。両方とも二つのショットでは物理的に画角外となる。

## カメラ

- SHOT 1／フレーム1〜89：信者Bの斜め正面バストショット。正投影の角度を固定し、フレーム9〜87で4%だけ平面TU、以後ハードカット直前まで停止する。
- SHOT 2／フレーム90〜168：信者B席の南寄りから北側上座へ切り返す、残念院さんの腰上ミディアムショット。正投影・完全固定。
- 00:03.70相当のフレーム90でカメラマーカーを切り替え、ディゾルブや回り込みを行わない。
- 二つのカメラは信者B—残念院さんの会話軸の同じ側にあり、180度ラインを越えない。

## 代理人物の扱い

- 室内には座席規則を検査するため信者B、残念院さん、信者Fの3人を同一縮尺で置く。
- SHOT 1に映る人物は信者Bだけ、SHOT 2に映る人物は残念院さんだけ。信者Fは両ショットで画角外。
- 代理人物の顔、髪、衣装、色、ローポリ形状、3DCG質感はSeedance完成画へ転写しない。
"""
with open(PLACEMENT_OUT, "w", encoding="utf-8", newline="\n") as handle:
    handle.write(placement)


def active_camera(frame):
    return camera_shot1 if frame < F_SHOT_2 else camera_shot2


if QC:
    qc_frames = report["qc_frames"]
    for index, frame in enumerate(qc_frames, 1):
        scene.frame_set(frame)
        scene.camera = active_camera(frame)
        bpy.context.view_layer.update()
        scene.render.filepath = os.path.join(OUT, f"q_{index:04d}.png")
        bpy.ops.render.render(write_still=True)
else:
    scene.render.filepath = os.path.join(OUT, "f_")
    bpy.ops.render.render(animation=True)

print("BLEND=" + BLEND_OUT)
print("REPORT=" + REPORT_OUT)
print("PLACEMENT=" + PLACEMENT_OUT)
