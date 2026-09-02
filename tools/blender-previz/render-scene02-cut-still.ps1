$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$blenderExe = Join-Path $repoRoot '.local-tools\blender\blender-5.2.1-windows-x64\blender.exe'
$renderScript = Join-Path $PSScriptRoot 'render_scene02_cut_still.py'
$seriesPackageRoot = Join-Path $repoRoot 'content\inbox\_series\untitled-short-anime\video-prompts\packages'
$roomPackageDir = Join-Path $seriesPackageRoot 'pilot-opening-meeting-scene05-seedance20-7s-multicut-v3-previz-only'
$scene02PackageDir = Join-Path $seriesPackageRoot 'pilot-opening-meeting-cut02-seedance20-4s-draft-v2-previz-only'
$sourceBlend = Join-Path $roomPackageDir 'previz\room-layout-v1\scene05-room-layout-box-v1.blend'
$outputDir = Join-Path $scene02PackageDir 'stills\blender-room-layout-v1'
$outputFile = Join-Path $outputDir 'scene02-former-cut02-frame-v1.png'
$blendFile = Join-Path $outputDir 'scene02-former-cut02-camera-v1.blend'
$reportFile = Join-Path $outputDir 'evaluation-scene02-former-cut02-v1.json'

if (-not (Test-Path -LiteralPath $blenderExe)) { throw "Blender was not found: $blenderExe" }
if (-not (Test-Path -LiteralPath $sourceBlend)) { throw "Room-layout source blend was not found: $sourceBlend" }

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$env:BLENDER_USER_RESOURCES = Join-Path $repoRoot '.local-tools\blender-profile'
$env:SCENE02_STILL_OUTFILE = $outputFile
$env:SCENE02_BLEND_OUT = $blendFile
$env:SCENE02_REPORT_OUT = $reportFile

& $blenderExe --background $sourceBlend --python-exit-code 1 --python $renderScript
if ($LASTEXITCODE -ne 0) { throw "SCENE 2 still render failed with exit code $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $outputFile)) { throw "Still image was not created: $outputFile" }
$report = Get-Content -LiteralPath $reportFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $report.passed) { throw "SCENE 2 composition evaluation failed. See $reportFile" }

Write-Output "STILL=$outputFile"
Write-Output "BLEND=$blendFile"
Write-Output "REPORT=$reportFile"
