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
ROOM_LAYOUT = os.environ.get("ROOM_LAYOUT", "0") == "1"
RICH_ROOM = os.environ.get("RICH_ROOM", "0") == "1"
ANIME_ROOM = os.environ.get("ANIME_ROOM", "0") == "1"
if RICH_ROOM and not ROOM_LAYOUT:
    raise RuntimeError("RICH_ROOM requires ROOM_LAYOUT=1")
if ANIME_ROOM and not RICH_ROOM:
    raise RuntimeError("ANIME_ROOM requires RICH_ROOM=1")
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
C_BASEBOARD = (0.16, 0.15, 0.13)
C_METAL = (0.34, 0.35, 0.34)
C_FLOOR_LINE = (0.29, 0.37, 0.32)
C_WALL_TRIM = (0.69, 0.65, 0.55)
C_DOOR_PANEL = (0.22, 0.13, 0.075)
C_SWITCH = (0.78, 0.77, 0.70)
C_SWITCH_DARK = (0.36, 0.35, 0.32)
C_SKY = (0.34, 0.53, 0.66)
C_CITY = (0.13, 0.16, 0.19)
C_CITY_LIGHT = (0.91, 0.71, 0.34)


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
    # The original shot previz was approved with size=1. The room-layout mode
    # restores the authored half-extents (Blender's default size=2) without
    # changing the existing camera-reference deliverable.
    bpy.ops.mesh.primitive_cube_add(
        size=2 if ROOM_LAYOUT else 1,
        location=loc,
        rotation=rot,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    set_color(obj, color)
    if parent:
        obj.parent = parent
    return obj


def bevel(obj, width=0.025, segments=2):
    modifier = obj.modifiers.new(name="RichRoom_Bevel", type="BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    return obj


def set_principled_input(shader, names, value):
    for name in names:
        socket = shader.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


def material_principled(
    name,
    color,
    roughness=0.65,
    metallic=0.0,
    emission=None,
    emission_strength=0.0,
    alpha=1.0,
    transmission=0.0,
    texture=None,
):
    material = bpy.data.materials.new(name=name)
    material.use_nodes = True
    material.diffuse_color = (*color, alpha)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    output.location = (520, 0)
    shader.location = (220, 0)
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    set_principled_input(shader, ("Base Color",), (*color, 1.0))
    set_principled_input(shader, ("Roughness",), roughness)
    set_principled_input(shader, ("Metallic",), metallic)
    set_principled_input(shader, ("Alpha",), alpha)
    set_principled_input(shader, ("Transmission Weight", "Transmission"), transmission)
    set_principled_input(shader, ("Specular IOR Level", "Specular"), 0.35)
    if emission is not None:
        set_principled_input(shader, ("Emission Color", "Emission"), (*emission, 1.0))
        set_principled_input(shader, ("Emission Strength",), emission_strength)

    if texture:
        texcoord = nodes.new("ShaderNodeTexCoord")
        texcoord.location = (-760, 0)
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.location = (-180, 80)
        ramp.color_ramp.elements[0].color = (*texture["dark"], 1.0)
        ramp.color_ramp.elements[1].color = (*texture["light"], 1.0)
        if texture["kind"] == "wood":
            source = nodes.new("ShaderNodeTexWave")
            source.wave_type = "BANDS"
            source.bands_direction = "X"
            source.inputs["Scale"].default_value = texture.get("scale", 5.0)
            source.inputs["Distortion"].default_value = texture.get("distortion", 7.0)
            source.inputs["Detail Scale"].default_value = 2.0
        else:
            source = nodes.new("ShaderNodeTexNoise")
            source.inputs["Scale"].default_value = texture.get("scale", 18.0)
            source.inputs["Detail"].default_value = texture.get("detail", 3.0)
            source.inputs["Roughness"].default_value = 0.65
        source.location = (-520, 50)
        links.new(texcoord.outputs["Generated"], source.inputs["Vector"])
        links.new(source.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
        bump = nodes.new("ShaderNodeBump")
        bump.location = (-20, -130)
        bump.inputs["Strength"].default_value = texture.get("bump", 0.10)
        bump.inputs["Distance"].default_value = texture.get("distance", 0.025)
        links.new(source.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], shader.inputs["Normal"])

    if alpha < 1.0:
        if hasattr(material, "surface_render_method"):
            material.surface_render_method = "DITHERED"
        elif hasattr(material, "blend_method"):
            material.blend_method = "BLEND"
        if hasattr(material, "use_transparency_overlap"):
            material.use_transparency_overlap = False
    return material


def assign_material(obj, material):
    if obj.type != "MESH":
        return
    obj.data.materials.clear()
    obj.data.materials.append(material)


def area_light(name, loc, target, energy, color, size, size_y=None):
    bpy.ops.object.light_add(type="AREA", location=loc)
    light = bpy.context.active_object
    light.name = name
    light.data.energy = energy
    light.data.color = color
    light.data.shape = "RECTANGLE"
    light.data.size = size
    light.data.size_y = size_y if size_y is not None else size
    light.data.use_shadow = True
    look_at(light, target)
    return light


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
scene.render.engine = "BLENDER_EEVEE" if ANIME_ROOM else "BLENDER_WORKBENCH"
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
if ANIME_ROOM:
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 18
    scene.render.film_transparent = False
    scene.render.filter_size = 1.25
    if scene.world is None:
        scene.world = bpy.data.worlds.new("AnimeRoomWorld")
    scene.world.use_nodes = True
    world_background = scene.world.node_tree.nodes.get("Background")
    world_background.inputs["Color"].default_value = (0.075, 0.095, 0.12, 1.0)
    world_background.inputs["Strength"].default_value = 0.16

# Room topology: north is +Y, east is +X.
floor = cube("Floor", (0, 0, -0.06), (4.2, 4.3, 0.06), C_FLOOR)
north_wall = cube("North_Wall", (0, 4.05, 1.55), (4.2, 0.08, 1.55), C_WALL)
west_wall = cube("West_Wall", (-4.05, 0, 1.55), (0.08, 4.1, 1.55), C_WALL)
east_wall = cube("East_Wall", (4.05, 0, 1.55), (0.08, 4.1, 1.55), C_WALL)
ceiling = cube("Ceiling", (0, 0, 3.12), (4.2, 4.3, 0.06), (0.40, 0.38, 0.33))
ceiling.hide_render = ROOM_LAYOUT
ceiling.hide_viewport = ROOM_LAYOUT

windows = []
window_parts = []
for index, y_pos in enumerate((-1.55, 1.30), 1):
    windows.append(
        cube(
            f"Window_{index}",
            (-3.96, y_pos, 1.65),
            (0.035, 0.72, 0.72),
            C_WINDOW,
        )
    )
    window_parts.append(cube(
        f"Window_Frame_{index}_Vertical",
        (-3.92, y_pos, 1.65),
        (0.035, 0.035, 0.76),
        C_TRIM,
    ))
    window_parts.append(cube(
        f"Window_Frame_{index}_Horizontal",
        (-3.92, y_pos, 1.65),
        (0.035, 0.76, 0.035),
        C_TRIM,
    ))

door = cube(
    "Door", (3.96, 2.55, 1.18), (0.05, 0.72, 1.18), (0.27, 0.17, 0.10)
)
# From the room interior/east-wall front view, north (+Y) is screen-left.
# Keep the handle on the left leaf edge in the shared room blockout.
door_handle = cube("Door_Handle", (3.86, 2.75, 1.18), (0.06, 0.04, 0.04), C_GOLD)
fluorescents = []
for index, y_pos in enumerate((-1.15, 1.30), 1):
    fluorescents.append(cube(
        f"Fluorescent_{index}",
        (0, y_pos, 3.02),
        (1.02, 0.16, 0.055),
        (0.92, 0.91, 0.79),
    ))

# North-wall banner and an upright proxy of the official diamond emblem.
notice_board = cube("Notice_Board", (0, 3.94, 2.15), (1.35, 0.035, 0.62), C_BOARD)
black_banner = cube("Black_Banner", (0, 3.86, 2.15), (1.05, 0.025, 0.48), C_BLACK)
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


if RICH_ROOM:
    # Edge softness keeps the blockout readable while remaining non-photoreal.
    for obj, width in (
        (floor, 0.025),
        (north_wall, 0.035),
        (west_wall, 0.035),
        (east_wall, 0.035),
        (door, 0.025),
        (door_handle, 0.018),
        (notice_board, 0.025),
        (black_banner, 0.015),
        (tabletop, 0.045),
    ):
        bevel(obj, width)
    for obj in windows + window_parts + fluorescents:
        bevel(obj, 0.018)
    for obj in fluorescents:
        obj.scale.x = 0.68
        obj.scale.y = 0.11

    # Dark skirting and corner trim around the three fixed walls.
    cube("Rich_Baseboard_North", (0, 3.90, 0.105), (3.92, 0.055, 0.105), C_BASEBOARD)
    cube("Rich_Baseboard_West", (-3.90, 0, 0.105), (0.055, 3.90, 0.105), C_BASEBOARD)
    cube("Rich_Baseboard_East", (3.90, 0, 0.105), (0.055, 3.90, 0.105), C_BASEBOARD)
    cube("Rich_CornerTrim_NW", (-3.89, 3.89, 1.55), (0.055, 0.055, 1.45), C_WALL_TRIM)
    cube("Rich_CornerTrim_NE", (3.89, 3.89, 1.55), (0.055, 0.055, 1.45), C_WALL_TRIM)

    # Worn vinyl-tile seams, kept shallow so they never read as extra furniture.
    for index, x_pos in enumerate((-3, -2, -1, 0, 1, 2, 3), 1):
        cube(f"Rich_FloorSeam_X_{index}", (x_pos, 0, 0.008), (0.009, 4.0, 0.006), C_FLOOR_LINE)
    for index, y_pos in enumerate((-3, -2, -1, 0, 1, 2, 3), 1):
        cube(f"Rich_FloorSeam_Y_{index}", (0, y_pos, 0.009), (4.0, 0.009, 0.006), C_FLOOR_LINE)
    for index, (x_pos, y_pos, length, yaw) in enumerate(
        ((-2.8, -2.7, 0.34, 8), (2.9, -2.1, 0.27, -12), (-2.6, 2.7, 0.24, -5), (2.5, 1.8, 0.31, 10)),
        1,
    ):
        cube(
            f"Rich_FloorScuff_{index}",
            (x_pos, y_pos, 0.021),
            (length, 0.018, 0.005),
            C_FLOOR_LINE,
            rot=(0, 0, D(yaw)),
        )

    # Window casings, inner stops, and sills on the west wall.
    for index, y_pos in enumerate((-1.55, 1.30), 1):
        for side in (-1, 1):
            bevel(cube(
                f"Rich_Window_{index}_Side_{side:+d}",
                (-3.84, y_pos + side * 0.79, 1.65),
                (0.055, 0.045, 0.79),
                C_WALL_TRIM,
            ), 0.012)
        bevel(cube(
            f"Rich_Window_{index}_Top",
            (-3.84, y_pos, 2.43),
            (0.055, 0.84, 0.045),
            C_WALL_TRIM,
        ), 0.012)
        bevel(cube(
            f"Rich_Window_{index}_Sill",
            (-3.78, y_pos, 0.88),
            (0.12, 0.86, 0.045),
            C_WALL_TRIM,
        ), 0.015)

    # Door frame, recessed panels, kick plate, hinges, and closer.
    for y_pos in (1.76, 3.34):
        bevel(cube(
            f"Rich_DoorFrame_{y_pos:.2f}",
            (3.84, y_pos, 1.22),
            (0.055, 0.055, 1.25),
            C_WALL_TRIM,
        ), 0.014)
    bevel(cube("Rich_DoorFrame_Top", (3.84, 2.55, 2.44), (0.055, 0.84, 0.055), C_WALL_TRIM), 0.014)
    bevel(cube("Rich_DoorPanel_Upper", (3.84, 2.55, 1.66), (0.018, 0.48, 0.31), C_DOOR_PANEL), 0.012)
    bevel(cube("Rich_DoorPanel_Lower", (3.84, 2.55, 0.75), (0.018, 0.48, 0.31), C_DOOR_PANEL), 0.012)
    cube("Rich_Door_KickPlate", (3.80, 2.55, 0.20), (0.018, 0.40, 0.10), C_METAL)
    cube("Rich_Door_Closer", (3.79, 2.55, 2.24), (0.035, 0.27, 0.045), C_METAL)
    cylinder_between("Rich_Door_CloserArm", (3.74, 2.48, 2.24), (3.74, 2.18, 2.34), 0.016, C_METAL)
    for index, z_pos in enumerate((0.42, 1.18, 1.94), 1):
        cube(f"Rich_Door_Hinge_{index}", (3.79, 1.91, z_pos), (0.025, 0.035, 0.075), C_METAL)

    # East-wall switch used by SCENE 2.
    bevel(cube("Rich_LightSwitch_Plate", (3.82, 1.45, 1.40), (0.035, 0.13, 0.18), C_SWITCH), 0.012)
    bevel(cube("Rich_LightSwitch_Toggle", (3.77, 1.45, 1.40), (0.018, 0.055, 0.085), C_SWITCH_DARK), 0.008)

    # Fluorescent housings and twin tubes; the open ceiling view keeps them visible.
    for index, y_pos in enumerate((-1.15, 1.30), 1):
        bevel(cube(
            f"Rich_Fluorescent_Housing_{index}",
            (0, y_pos, 3.075),
            (0.76, 0.17, 0.035),
            C_METAL,
        ), 0.018)
        for tube_index, tube_y in enumerate((-0.075, 0.075), 1):
            bevel(cube(
                f"Rich_Fluorescent_{index}_Tube_{tube_index}",
                (0, y_pos + tube_y, 3.015),
                (0.62, 0.028, 0.022),
                C_WHITE,
            ), 0.012)

    # Table understructure and modesty rails, without changing the tabletop footprint.
    for y_pos in (-1.74, 2.44):
        bevel(cube(
            f"Rich_Table_EndApron_{y_pos:+.2f}",
            (0, y_pos, 0.64),
            (1.28, 0.035, 0.10),
            C_TRIM,
        ), 0.012)
    for x_pos in (-1.33, 1.33):
        bevel(cube(
            f"Rich_Table_LongApron_{x_pos:+.2f}",
            (x_pos, 0.35, 0.64),
            (0.035, 2.02, 0.10),
            C_TRIM,
        ), 0.012)
    cylinder_between("Rich_Table_CrossBrace", (-1.10, 0.35, 0.33), (1.10, 0.35, 0.33), 0.025, C_METAL)


if ANIME_ROOM:
    # Replace the solid blockout walls with modeled openings. The room envelope,
    # window centers, and door center remain identical to the approved layout.
    west_wall.hide_render = True
    west_wall.hide_viewport = True
    east_wall.hide_render = True
    east_wall.hide_viewport = True

    west_wall_parts = [
        cube("Anime_WestWall_Lower", (-4.05, 0, 0.46), (0.08, 4.10, 0.46), C_WALL),
        cube("Anime_WestWall_Upper", (-4.05, 0, 2.74), (0.08, 4.10, 0.36), C_WALL),
        cube("Anime_WestWall_SouthPier", (-4.05, -3.18, 1.55), (0.08, 0.92, 1.55), C_WALL),
        cube("Anime_WestWall_CenterPier", (-4.05, -0.13, 1.55), (0.08, 0.70, 1.55), C_WALL),
        cube("Anime_WestWall_NorthPier", (-4.05, 3.06, 1.55), (0.08, 1.04, 1.55), C_WALL),
    ]
    east_wall_parts = [
        cube("Anime_EastWall_South", (4.05, -1.14, 1.55), (0.08, 2.96, 1.55), C_WALL),
        cube("Anime_EastWall_North", (4.05, 3.69, 1.55), (0.08, 0.41, 1.55), C_WALL),
        cube("Anime_EastWall_DoorHeader", (4.05, 2.55, 2.74), (0.08, 0.73, 0.36), C_WALL),
    ]
    for wall_part in west_wall_parts + east_wall_parts:
        bevel(wall_part, 0.018, 3)

    # Recessed window views give the panes depth instead of reading as blue clay.
    for index, y_pos in enumerate((-1.55, 1.30), 1):
        cube(f"Anime_WindowSky_{index}", (-4.16, y_pos, 1.65), (0.018, 0.70, 0.70), C_SKY)
        for building_index, (offset, width, height) in enumerate(
            ((-0.48, 0.16, 0.58), (-0.18, 0.12, 0.36), (0.09, 0.17, 0.50), (0.39, 0.13, 0.29)),
            1,
        ):
            cube(
                f"Anime_Window{index}_Building_{building_index}",
                (-4.13, y_pos + offset, 1.02 + height * 0.5),
                (0.018, width, height * 0.5),
                C_CITY,
            )
        cube(f"Anime_Window{index}_Mullion", (-3.80, y_pos, 1.65), (0.025, 0.025, 0.72), C_METAL)
        cube(f"Anime_Window{index}_BlindRail", (-3.76, y_pos, 2.37), (0.045, 0.68, 0.055), C_METAL)

    # Architectural rhythm and functional details keep wide shots from feeling empty.
    for index, y_pos in enumerate((-2.72, -0.13, 2.82), 1):
        bevel(cube(f"Anime_EastWall_Pilaster_{index}", (3.88, y_pos, 1.55), (0.045, 0.055, 1.42), C_WALL_TRIM), 0.012)
    cube("Anime_North_CrownTrim", (0, 3.88, 2.96), (3.88, 0.055, 0.055), C_WALL_TRIM)
    cube("Anime_West_CrownTrim", (-3.88, 0, 2.96), (0.055, 3.88, 0.055), C_WALL_TRIM)
    cube("Anime_East_CrownTrim", (3.88, 0, 2.96), (0.055, 3.88, 0.055), C_WALL_TRIM)
    for index, y_pos in enumerate((-2.70, 0.05), 1):
        bevel(cube(f"Anime_East_OutletPlate_{index}", (3.82, y_pos, 0.42), (0.035, 0.11, 0.14), C_SWITCH), 0.010)
        cube(f"Anime_East_OutletSlot_{index}_A", (3.77, y_pos - 0.035, 0.43), (0.012, 0.010, 0.035), C_SWITCH_DARK)
        cube(f"Anime_East_OutletSlot_{index}_B", (3.77, y_pos + 0.035, 0.43), (0.012, 0.010, 0.035), C_SWITCH_DARK)

    # Extra furniture construction details visible in medium and wide angles.
    bevel(cube("Anime_Table_EdgeBand_West", (-1.405, 0.35, 0.78), (0.018, 2.16, 0.065), C_TRIM), 0.010)
    bevel(cube("Anime_Table_EdgeBand_East", (1.405, 0.35, 0.78), (0.018, 2.16, 0.065), C_TRIM), 0.010)
    bevel(cube("Anime_Table_CableTray", (0, 0.35, 0.49), (0.55, 1.40, 0.035), C_METAL), 0.014)


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


if ANIME_ROOM:
    # Production-style anime background materials: restrained contrast, broad
    # highlights, and subtle procedural breakup without photographic noise.
    mat_wall = material_principled(
        "Anime_BG_PaintedWall",
        (0.50, 0.46, 0.36),
        roughness=0.84,
        texture={"kind": "noise", "dark": (0.43, 0.40, 0.32), "light": (0.59, 0.55, 0.44), "scale": 28.0, "detail": 2.0, "bump": 0.055, "distance": 0.018},
    )
    mat_floor = material_principled(
        "Anime_BG_VinylFloor",
        (0.27, 0.35, 0.30),
        roughness=0.70,
        texture={"kind": "noise", "dark": (0.21, 0.29, 0.25), "light": (0.38, 0.46, 0.39), "scale": 8.0, "detail": 4.0, "bump": 0.085, "distance": 0.028},
    )
    mat_floor_line = material_principled("Anime_BG_FloorJoint", (0.16, 0.22, 0.19), roughness=0.82)
    mat_wood = material_principled(
        "Anime_BG_WalnutWood",
        (0.30, 0.16, 0.075),
        roughness=0.52,
        texture={"kind": "noise", "dark": (0.060, 0.020, 0.008), "light": (0.13, 0.050, 0.016), "scale": 3.5, "detail": 2.0, "bump": 0.018, "distance": 0.010},
    )
    mat_dark_wood = material_principled(
        "Anime_BG_DarkWood",
        (0.15, 0.07, 0.025),
        roughness=0.48,
        texture={"kind": "wood", "dark": (0.045, 0.018, 0.009), "light": (0.25, 0.105, 0.035), "scale": 8.0, "distortion": 5.0, "bump": 0.08, "distance": 0.025},
    )
    mat_trim = material_principled("Anime_BG_PaintedTrim", (0.64, 0.59, 0.48), roughness=0.58)
    mat_metal = material_principled("Anime_BG_BrushedSteel", (0.29, 0.31, 0.32), roughness=0.34, metallic=0.78)
    mat_gold = material_principled("Anime_BG_AgedBrass", (0.66, 0.38, 0.08), roughness=0.30, metallic=0.70)
    mat_glass = material_principled("Anime_BG_WindowGlass", (0.36, 0.58, 0.68), roughness=0.13, alpha=0.34, transmission=0.28)
    mat_sky = material_principled("Anime_BG_WindowSky", C_SKY, roughness=0.9, emission=(0.24, 0.47, 0.66), emission_strength=0.38)
    mat_city = material_principled("Anime_BG_CitySilhouette", C_CITY, roughness=0.82)
    mat_light = material_principled("Anime_BG_FluorescentGlow", (0.92, 0.90, 0.76), roughness=0.30, emission=(0.92, 0.88, 0.68), emission_strength=3.0)
    mat_banner = material_principled(
        "Anime_BG_BannerCloth",
        C_BLACK,
        roughness=0.92,
        texture={"kind": "noise", "dark": (0.018, 0.020, 0.026), "light": (0.095, 0.10, 0.11), "scale": 34.0, "detail": 2.0, "bump": 0.13, "distance": 0.02},
    )
    mat_cork = material_principled(
        "Anime_BG_CorkBoard",
        C_BOARD,
        roughness=0.88,
        texture={"kind": "noise", "dark": (0.25, 0.14, 0.065), "light": (0.55, 0.36, 0.15), "scale": 18.0, "detail": 4.0, "bump": 0.16, "distance": 0.025},
    )
    mat_chair = material_principled("Anime_BG_ChairVinyl", (0.075, 0.085, 0.095), roughness=0.48)
    mat_plastic = material_principled("Anime_BG_MattePlastic", C_CHARCOAL, roughness=0.40)
    flat_materials = {}

    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        name = obj.name
        if name.startswith(("BelieverB_", "BelieverF_", "Zannenin_")):
            rgb = tuple(round(component, 4) for component in obj.color[:3])
            if rgb not in flat_materials:
                flat_materials[rgb] = material_principled(
                    "Character_Flat_{:02d}".format(len(flat_materials) + 1),
                    rgb,
                    roughness=0.78,
                )
            assign_material(obj, flat_materials[rgb])
        elif name == "Floor":
            assign_material(obj, mat_floor)
        elif "FloorSeam" in name or "FloorScuff" in name:
            assign_material(obj, mat_floor_line)
        elif "Wall" in name and "Trim" not in name and "Pilaster" not in name:
            assign_material(obj, mat_wall)
        elif name.startswith("Window_") and "Frame" not in name:
            assign_material(obj, mat_glass)
        elif "WindowSky" in name:
            assign_material(obj, mat_sky)
        elif "Building" in name:
            assign_material(obj, mat_city)
        elif "Fluorescent" in name and "Housing" not in name:
            assign_material(obj, mat_light)
        elif name == "Black_Banner":
            assign_material(obj, mat_banner)
        elif name == "Notice_Board":
            assign_material(obj, mat_cork)
        elif name.startswith("Emblem_") or name == "Door_Handle":
            assign_material(obj, mat_gold)
        elif name == "Table_ContinuousTop" or "Table_EdgeBand" in name:
            assign_material(obj, mat_wood)
        elif name == "Door" or "DoorPanel" in name or "Table_EndApron" in name or "Table_LongApron" in name or name == "Table_South_Edge":
            assign_material(obj, mat_dark_wood)
        elif name.startswith("Chair_") and ("Seat" in name or "Back" in name):
            assign_material(obj, mat_chair)
        elif name.startswith("Laptop_"):
            assign_material(obj, mat_plastic)
        elif any(token in name for token in ("Metal", "Hinge", "Closer", "Housing", "CableTray", "CrossBrace", "_Leg_", "Mullion", "BlindRail")):
            assign_material(obj, mat_metal)
        elif any(token in name for token in ("Baseboard", "CornerTrim", "CrownTrim", "DoorFrame", "Window_Frame", "Rich_Window", "Pilaster")):
            assign_material(obj, mat_trim)
        else:
            rgb = tuple(round(component, 4) for component in obj.color[:3])
            if rgb not in flat_materials:
                flat_materials[rgb] = material_principled(
                    "Room_Flat_{:02d}".format(len(flat_materials) + 1),
                    rgb,
                    roughness=0.68,
                )
            assign_material(obj, flat_materials[rgb])

    # Broad, soft sources are closer to an anime background plate than a hard
    # photoreal spotlight setup, while still grounding furniture with shadows.
    area_light("Anime_Key_Ceiling_South", (0, -1.15, 2.90), (0, -1.15, 0.20), 145, (1.0, 0.87, 0.68), 2.2, 0.85)
    area_light("Anime_Key_Ceiling_North", (0, 1.30, 2.90), (0, 1.30, 0.20), 155, (1.0, 0.87, 0.68), 2.2, 0.85)
    area_light("Anime_WindowFill_South", (-3.65, -1.55, 1.70), (-0.8, -1.20, 1.05), 135, (0.52, 0.72, 1.0), 1.8, 2.0)
    area_light("Anime_WindowFill_North", (-3.65, 1.30, 1.70), (-0.8, 1.05, 1.05), 125, (0.52, 0.72, 1.0), 1.8, 2.0)
    area_light("Anime_FrontFill", (0, -3.45, 2.25), (0, 0.30, 1.0), 55, (1.0, 0.56, 0.38), 2.8, 1.4)


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


def build_perspective_camera(name, loc, target, lens=35.0):
    bpy.ops.object.camera_add(location=loc)
    camera = bpy.context.active_object
    camera.name = name
    camera.data.type = "PERSP"
    camera.data.lens = lens
    camera.data.sensor_width = 36.0
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

# Room-layout cameras are stored in the same scene so the blockout and shot previz
# cannot silently drift apart. In layout mode the blend opens on the top view.
camera_layout_top = build_ortho_camera(
    "Camera_LAYOUT_Top",
    (0, 0.15, 10.5),
    (0, 0.15, 0),
    9.4,
)
camera_layout_south = build_ortho_camera(
    "Camera_LAYOUT_SouthOblique",
    (7.0, -8.0, 6.2),
    (0, 0.35, 0.85),
    10.2,
)
camera_layout_entrance = build_ortho_camera(
    "Camera_LAYOUT_FromEntrance",
    (3.15, 2.55, 3.15),
    (-0.25, 0.35, 0.85),
    7.2,
)
camera_anime_wide = None
camera_anime_entrance = None
if ANIME_ROOM:
    camera_anime_wide = build_perspective_camera(
        "Camera_ANIME_Wide",
        (2.55, -7.65, 4.15),
        (0, 0.45, 1.10),
        38.0,
    )
    camera_anime_entrance = build_perspective_camera(
        "Camera_ANIME_FromEntrance",
        (3.35, 2.55, 2.20),
        (-0.30, 0.15, 1.00),
        31.0,
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
scene.camera = camera_layout_top if ROOM_LAYOUT else camera_shot1
if ROOM_LAYOUT:
    # Bound timeline cameras override scene.camera during still rendering.
    # The layout deliverable keeps the shot cameras but disables the cut bindings.
    marker1.camera = None
    marker2.camera = None


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
    "name": "scene05-room-anime-production-v3" if ANIME_ROOM else "pilot-opening-meeting-scene05-previz-v1-2d-camera",
    "passed": ROOM_LAYOUT or (
        all(value > 0 for value in camera_side_signs)
        and openings_out_of_frame
        and subjects_isolated
    ),
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
    "room_layout_mode": ROOM_LAYOUT,
    "rich_room_mode": RICH_ROOM,
    "anime_room_mode": ANIME_ROOM,
    "render_engine": scene.render.engine,
    "shot_evaluation_applicable": not ROOM_LAYOUT,
    "room_layout": {
        "room_size_blender_units": [8.4, 8.6, 3.1],
        "north": "+Y",
        "east": "+X",
        "ceiling_hidden": ROOM_LAYOUT,
        "open_dollhouse_side": "south",
    },
    "room_layout_cameras": [
        camera_layout_top.name,
        (camera_anime_wide.name if ANIME_ROOM else camera_layout_south.name),
        (camera_anime_entrance.name if ANIME_ROOM else camera_layout_entrance.name),
    ],
    "rich_room_details": {
        "characters_modified": False,
        "baseboards": 3 if RICH_ROOM else 0,
        "floor_seams": 14 if RICH_ROOM else 0,
        "floor_scuffs": 4 if RICH_ROOM else 0,
        "window_casings_and_sills": 8 if RICH_ROOM else 0,
        "door_frame_and_hardware_parts": 10 if RICH_ROOM else 0,
        "light_switches": 1 if RICH_ROOM else 0,
        "fluorescent_housings": 2 if RICH_ROOM else 0,
        "table_aprons_and_braces": 5 if RICH_ROOM else 0,
    },
    "anime_room_details": {
        "characters_modified": False,
        "character_geometry_pose_palette_locked": True if ANIME_ROOM else False,
        "modeled_wall_openings": 3 if ANIME_ROOM else 0,
        "procedural_material_families": 13 if ANIME_ROOM else 0,
        "soft_area_lights": 5 if ANIME_ROOM else 0,
        "perspective_preview_cameras": 2 if ANIME_ROOM else 0,
        "style": "stylized 3D anime background PBR" if ANIME_ROOM else None,
    },
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
if ROOM_LAYOUT:
    placement += """

## 箱モデル確認ビュー

- `layout_0001.png`: 天井を外した上面図。画像上が北、右が東。
- `layout_0002.png`: 南側から見た斜視。西壁の窓2つと北壁の掲示物を確認する。
- `layout_0003.png`: 東壁の入口から室内を見た斜視。信者B側のPCと3席の関係を確認する。
- 箱モデルの外形は幅8.4、奥行8.6、高さ3.1 Blender unit。南側はドールハウス表示のため開放し、天井は非表示にする。
"""
if RICH_ROOM:
    placement += """

## リッチ部屋版

- キャラクターの形状、色、位置、アニメーションは変更しない。
- 巾木、床タイル目地と軽い擦れ、窓枠と窓台、ドア枠・パネル・蝶番・クローザー、照明スイッチ、蛍光灯筐体、机の幕板と補強を追加する。
- 家具、窓、扉、壁、カメラの基本座標と個数は標準箱モデルから変更しない。
"""
if ANIME_ROOM:
    placement += """

## 3Dアニメ背景版

- キャラクター3名の形状、ポーズ、配置、色設計は変更しない。
- 壁と床は微細な凹凸を持つマット素材、机と扉は木目、金物は金属、窓は透過ガラスとして分離する。
- 西壁の窓2つと東壁の扉1つは、貼り付け板ではなく実際の壁開口として再構成する。
- 蛍光灯の暖色キー、窓からの寒色フィル、南側の弱い補助光でアニメ背景向けの面構成を作る。
- 上面図は配置確認用、残り2枚はパース付きの背景美術確認用カメラとする。
"""
with open(PLACEMENT_OUT, "w", encoding="utf-8", newline="\n") as handle:
    handle.write(placement)


def active_camera(frame):
    return camera_shot1 if frame < F_SHOT_2 else camera_shot2


if ROOM_LAYOUT:
    scene.render.resolution_x = 1920 if ANIME_ROOM else (1600 if RICH_ROOM else 1280)
    scene.render.resolution_y = 1080 if ANIME_ROOM else (900 if RICH_ROOM else 720)
    scene.render.resolution_percentage = 100
    scene.frame_set(1)
    layout_views = (
        ("layout_0001.png", camera_layout_top),
        ("layout_0002.png", camera_anime_wide if ANIME_ROOM else camera_layout_south),
        ("layout_0003.png", camera_anime_entrance if ANIME_ROOM else camera_layout_entrance),
    )
    for filename, camera in layout_views:
        scene.camera = camera
        bpy.context.view_layer.update()
        scene.render.filepath = os.path.join(OUT, filename)
        bpy.ops.render.render(write_still=True)
elif QC:
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
