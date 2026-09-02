$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$blenderExe = Join-Path $repoRoot '.local-tools\blender\blender-5.2.1-windows-x64\blender.exe'
$sourceScript = Join-Path $PSScriptRoot 'create_scene05_meeting_previz.py'
$packageDir = Join-Path $repoRoot 'content\inbox\_series\untitled-short-anime\video-prompts\packages\pilot-opening-meeting-scene05-seedance20-7s-multicut-v3-previz-only'
$outputDir = Join-Path $packageDir 'previz\room-layout-v1'
$blendFile = Join-Path $outputDir 'scene05-room-layout-box-v1.blend'
$reportFile = Join-Path $outputDir 'evaluation-room-layout-v1.json'
$placementFile = Join-Path $outputDir 'room-layout-plan-v1.md'
$contactSheet = Join-Path $outputDir 'room-layout-contact-sheet-v1.jpg'

if (-not (Test-Path -LiteralPath $blenderExe)) { throw "Blender was not found: $blenderExe" }
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) { throw 'FFmpeg was not found on PATH.' }

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$env:BLENDER_USER_RESOURCES = Join-Path $repoRoot '.local-tools\blender-profile'
$env:OUTDIR = $outputDir
$env:BLEND_OUT = $blendFile
$env:REPORT_OUT = $reportFile
$env:PLACEMENT_OUT = $placementFile
$env:QC = '0'
$env:ROOM_LAYOUT = '1'

& $blenderExe --background --python-exit-code 1 --python $sourceScript
if ($LASTEXITCODE -ne 0) { throw "SCENE 5 room-layout build failed with exit code $LASTEXITCODE" }

$report = Get-Content -LiteralPath $reportFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $report.passed -or -not $report.room_layout_mode) {
    throw "SCENE 5 room-layout evaluation failed. See $reportFile"
}
if ($report.fixed_counts.continuous_tables -ne 1 -or
    $report.fixed_counts.executive_chairs -ne 1 -or
    $report.fixed_counts.folding_chairs -ne 2 -or
    $report.fixed_counts.laptops -ne 1 -or
    $report.fixed_counts.windows -ne 2 -or
    $report.fixed_counts.doors -ne 1) {
    throw "SCENE 5 room-layout count evaluation failed. See $reportFile"
}

& $ffmpeg.Source -hide_banner -loglevel error -y -framerate 1 -start_number 1 -i (Join-Path $outputDir 'layout_%04d.png') `
    -vf "scale=480:-1,tile=3x1:nb_frames=3" -frames:v 1 -update 1 $contactSheet
if ($LASTEXITCODE -ne 0) { throw "Room-layout contact sheet failed with exit code $LASTEXITCODE" }

Write-Output "BLEND=$blendFile"
Write-Output "REPORT=$reportFile"
Write-Output "PLACEMENT=$placementFile"
Write-Output "CONTACT_SHEET=$contactSheet"
