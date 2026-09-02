"""Render one full-HD still from SCENE 5 SHOT 2."""

import bpy
import os


FRAME = int(os.environ.get("STILL_FRAME", "120"))
OUTFILE = os.environ["STILL_OUTFILE"]

scene = bpy.context.scene
camera = bpy.data.objects.get("Camera_SHOT2_Zannenin")
if camera is None or camera.type != "CAMERA":
    raise RuntimeError("Camera_SHOT2_Zannenin was not found in the source blend")

scene.frame_set(FRAME)
scene.camera = camera
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = OUTFILE
bpy.context.view_layer.update()
bpy.ops.render.render(write_still=True)

print("STILL=" + OUTFILE)
print("FRAME=" + str(FRAME))
