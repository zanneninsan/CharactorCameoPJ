$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$blenderExe = Join-Path $repoRoot '.local-tools\blender\blender-5.2.1-windows-x64\blender.exe'
$sourceScript = Join-Path $PSScriptRoot 'create_scene01_impact_previz.py'
$baseBlend = Join-Path $repoRoot 'content\inbox\_series\untitled-short-anime\video-prompts\packages\pilot-opening-meeting-scene05-seedance20-7s-multicut-v3-previz-only\previz\room-layout-anime-v3\scene05-room-layout-anime-v3.blend'
$packageDir = Join-Path $repoRoot 'content\inbox\_series\untitled-short-anime\video-prompts\packages\pilot-opening-meeting-cut01-seedance20-7s-blocking-board-v1'
$outputDir = Join-Path $packageDir 'previz\scene01-impact-v2'
$framesDir = Join-Path $outputDir 'frames'
$blendFile = Join-Path $outputDir 'scene01-impact-camera-previz-v2.blend'
$reportFile = Join-Path $outputDir 'evaluation-scene01-impact-v2.json'
$planFile = Join-Path $outputDir 'scene01-impact-plan-v2.md'
$silentVideo = Join-Path $outputDir 'scene01-impact-camera-previz-v2-silent.mp4'
$videoFile = Join-Path $outputDir 'scene01-impact-camera-previz-v2.mp4'
$contactSheet = Join-Path $outputDir 'scene01-impact-contact-sheet-v2.jpg'
$audioFile = Join-Path $packageDir '08-audio-cut01-zannenin-opening-108pct-7s.wav'

foreach ($requiredFile in @($blenderExe, $sourceScript, $baseBlend, $audioFile)) {
    if (-not (Test-Path -LiteralPath $requiredFile)) { throw "Required file was not found: $requiredFile" }
}
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
$ffprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
if (-not $ffmpeg -or -not $ffprobe) { throw 'FFmpeg and ffprobe are required.' }

New-Item -ItemType Directory -Force -Path $outputDir, $framesDir | Out-Null
$env:OUTDIR = $outputDir
$env:BLEND_OUT = $blendFile
$env:REPORT_OUT = $reportFile
$env:PLAN_OUT = $planFile
$env:QC = '0'

& $blenderExe --background $baseBlend --python-exit-code 1 --python $sourceScript
if ($LASTEXITCODE -ne 0) { throw "SCENE 01 impact previz build failed with exit code $LASTEXITCODE" }

& $ffmpeg.Source -hide_banner -loglevel error -y -framerate 24 -start_number 1 -i (Join-Path $framesDir 'frame_%04d.png') `
    -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an $silentVideo
if ($LASTEXITCODE -ne 0) { throw "SCENE 01 silent previz encode failed with exit code $LASTEXITCODE" }

& $ffmpeg.Source -hide_banner -loglevel error -y -i $silentVideo -i $audioFile `
    -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -t 7.0 -movflags +faststart $videoFile
if ($LASTEXITCODE -ne 0) { throw "SCENE 01 audio mux failed with exit code $LASTEXITCODE" }

& $ffmpeg.Source -hide_banner -loglevel error -y -i $videoFile `
    -vf "select='eq(n,0)+eq(n,47)+eq(n,76)+eq(n,82)+eq(n,87)+eq(n,119)',scale=640:-1,tile=3x2:nb_frames=6" `
    -vsync vfr -frames:v 1 -update 1 -q:v 2 $contactSheet
if ($LASTEXITCODE -ne 0) { throw "SCENE 01 contact sheet failed with exit code $LASTEXITCODE" }

$probe = & $ffprobe.Source -v error -show_entries format=duration:stream=codec_type,width,height -of json $videoFile | ConvertFrom-Json
$videoStream = $probe.streams | Where-Object codec_type -eq 'video' | Select-Object -First 1
$audioStream = $probe.streams | Where-Object codec_type -eq 'audio' | Select-Object -First 1
if (-not $videoStream -or -not $audioStream -or $videoStream.width -ne 960 -or $videoStream.height -ne 540 -or [math]::Abs([double]$probe.format.duration - 7.0) -gt 0.08) {
    throw "SCENE 01 output validation failed: $($probe | ConvertTo-Json -Depth 8)"
}

Write-Output "BLEND=$blendFile"
Write-Output "VIDEO=$videoFile"
Write-Output "CONTACT_SHEET=$contactSheet"
Write-Output "REPORT=$reportFile"
Write-Output "PLAN=$planFile"
