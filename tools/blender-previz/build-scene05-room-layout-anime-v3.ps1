$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$blenderExe = Join-Path $repoRoot '.local-tools\blender\blender-5.2.1-windows-x64\blender.exe'
$sourceScript = Join-Path $PSScriptRoot 'create_scene05_meeting_previz.py'
$packageDir = Join-Path $repoRoot 'content\inbox\_series\untitled-short-anime\video-prompts\packages\pilot-opening-meeting-scene05-seedance20-7s-multicut-v3-previz-only'
$outputDir = Join-Path $packageDir 'previz\room-layout-anime-v3'
$blendFile = Join-Path $outputDir 'scene05-room-layout-anime-v3.blend'
$reportFile = Join-Path $outputDir 'evaluation-room-layout-anime-v3.json'
$placementFile = Join-Path $outputDir 'room-layout-anime-plan-v3.md'
$contactSheet = Join-Path $outputDir 'room-layout-anime-contact-sheet-v3.jpg'

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
$env:RICH_ROOM = '1'
$env:ANIME_ROOM = '1'

& $blenderExe --background --python-exit-code 1 --python $sourceScript
if ($LASTEXITCODE -ne 0) { throw "SCENE 5 anime room build failed with exit code $LASTEXITCODE" }

$report = Get-Content -LiteralPath $reportFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $report.passed -or -not $report.room_layout_mode -or -not $report.rich_room_mode -or -not $report.anime_room_mode) {
    throw "SCENE 5 anime room evaluation failed. See $reportFile"
}
if ($report.anime_room_details.characters_modified -or
    -not $report.anime_room_details.character_geometry_pose_palette_locked -or
    $report.render_engine -ne 'BLENDER_EEVEE' -or
    $report.fixed_counts.characters_in_room -ne 3 -or
    $report.fixed_counts.continuous_tables -ne 1 -or
    $report.fixed_counts.executive_chairs -ne 1 -or
    $report.fixed_counts.folding_chairs -ne 2 -or
    $report.fixed_counts.laptops -ne 1 -or
    $report.fixed_counts.windows -ne 2 -or
    $report.fixed_counts.doors -ne 1) {
    throw "SCENE 5 anime-room identity, renderer, or placement evaluation failed. See $reportFile"
}

& $ffmpeg.Source -hide_banner -loglevel error -y -i (Join-Path $outputDir 'layout_%04d.png') `
    -vf "scale=640:-1,tile=3x1:nb_frames=3" -frames:v 1 -update 1 -q:v 2 $contactSheet
if ($LASTEXITCODE -ne 0) { throw "Anime room contact sheet failed with exit code $LASTEXITCODE" }

Write-Output "BLEND=$blendFile"
Write-Output "REPORT=$reportFile"
Write-Output "PLACEMENT=$placementFile"
Write-Output "CONTACT_SHEET=$contactSheet"
