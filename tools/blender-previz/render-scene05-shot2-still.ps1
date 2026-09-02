$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$blenderExe = Join-Path $repoRoot '.local-tools\blender\blender-5.2.1-windows-x64\blender.exe'
$renderScript = Join-Path $PSScriptRoot 'render_scene05_shot2_still.py'
$packageDir = Join-Path $repoRoot 'content\inbox\_series\untitled-short-anime\video-prompts\packages\pilot-opening-meeting-scene05-seedance20-7s-multicut-v3-previz-only'
$blendFile = Join-Path $packageDir 'previz\v1-2d-camera\pilot-opening-meeting-scene05-previz-v1-2d-camera.blend'
$outputDir = Join-Path $packageDir 'stills'
$outputFile = Join-Path $outputDir 'scene05-shot2-frame120-v1.png'

if (-not (Test-Path -LiteralPath $blenderExe)) { throw "Blender was not found: $blenderExe" }
if (-not (Test-Path -LiteralPath $blendFile)) { throw "Source blend was not found: $blendFile" }

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$env:BLENDER_USER_RESOURCES = Join-Path $repoRoot '.local-tools\blender-profile'
$env:STILL_FRAME = '120'
$env:STILL_OUTFILE = $outputFile

& $blenderExe --background $blendFile --python-exit-code 1 --python $renderScript
if ($LASTEXITCODE -ne 0) { throw "SCENE 5 SHOT 2 still render failed with exit code $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $outputFile)) { throw "Still image was not created: $outputFile" }

Write-Output "STILL=$outputFile"
