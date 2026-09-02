param([switch]$QualityControlOnly)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$blenderExe = Join-Path $repoRoot '.local-tools\blender\blender-5.2.1-windows-x64\blender.exe'
$sourceScript = Join-Path $PSScriptRoot 'create_scene05_meeting_previz.py'
$packageDir = Join-Path $repoRoot 'content\inbox\_series\untitled-short-anime\video-prompts\packages\pilot-opening-meeting-scene05-seedance20-7s-multicut-v3-previz-only'
$outputDir = Join-Path $packageDir 'previz\v1-2d-camera'
$framesDir = if ($QualityControlOnly) { Join-Path $outputDir 'qc' } else { Join-Path $outputDir 'frames' }
$blendFile = Join-Path $outputDir 'pilot-opening-meeting-scene05-previz-v1-2d-camera.blend'
$reportFile = Join-Path $outputDir 'evaluation-v1-2d-camera.json'
$placementFile = Join-Path $outputDir 'placement-camera-plan-v1-2d-camera.md'
$silentVideo = Join-Path $outputDir 'pilot-opening-meeting-scene05-previz-v1-2d-camera-silent.mp4'
$videoFile = Join-Path $outputDir 'pilot-opening-meeting-scene05-previz-v1-2d-camera-7s.mp4'
$audioB = Join-Path $packageDir '06-audio-believer-b-summary.mp3'
$audioZ = Join-Path $packageDir '07-audio-zannenin-reply.mp3'

if (-not (Test-Path -LiteralPath $blenderExe)) { throw "Blender was not found: $blenderExe" }
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) { throw 'FFmpeg was not found on PATH.' }
$ffprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
if (-not $ffprobe) { throw 'FFprobe was not found on PATH.' }

New-Item -ItemType Directory -Force -Path $framesDir | Out-Null
$resolvedOutput = (Resolve-Path -LiteralPath $outputDir).Path
$resolvedFrames = (Resolve-Path -LiteralPath $framesDir).Path
if (-not $resolvedFrames.StartsWith($resolvedOutput, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Frame directory escaped the intended output directory: $resolvedFrames"
}
Get-ChildItem -LiteralPath $resolvedFrames -Filter '*.png' -File | Remove-Item -Force

$env:BLENDER_USER_RESOURCES = Join-Path $repoRoot '.local-tools\blender-profile'
$env:OUTDIR = $framesDir
$env:BLEND_OUT = $blendFile
$env:REPORT_OUT = $reportFile
$env:PLACEMENT_OUT = $placementFile
$env:QC = if ($QualityControlOnly) { '1' } else { '0' }

& $blenderExe --background --python-exit-code 1 --python $sourceScript
if ($LASTEXITCODE -ne 0) { throw "SCENE 5 Blender build failed with exit code $LASTEXITCODE" }

$report = Get-Content -LiteralPath $reportFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $report.passed -or -not $report.openings_out_of_frame) {
    throw "SCENE 5 spatial evaluation failed. See $reportFile"
}
if ($report.fixed_counts.continuous_tables -ne 1 -or
    $report.fixed_counts.executive_chairs -ne 1 -or
    $report.fixed_counts.folding_chairs -ne 2 -or
    $report.fixed_counts.laptops -ne 1) {
    throw "SCENE 5 furniture count evaluation failed. See $reportFile"
}

if ($QualityControlOnly) {
    & $ffmpeg.Source -hide_banner -loglevel error -y -framerate 1 -start_number 1 -i (Join-Path $framesDir 'q_%04d.png') `
        -vf "scale=360:-1,tile=4x2:nb_frames=8" -frames:v 1 -update 1 (Join-Path $outputDir 'qc-contact-sheet-v1-2d-camera.jpg')
    if ($LASTEXITCODE -ne 0) { throw "QC contact sheet failed with exit code $LASTEXITCODE" }
}
else {
    & $ffmpeg.Source -hide_banner -loglevel error -y -framerate 24 -start_number 1 -i (Join-Path $framesDir 'f_%04d.png') `
        -c:v libx264 -pix_fmt yuv420p -crf 17 -movflags +faststart $silentVideo
    if ($LASTEXITCODE -ne 0) { throw "MP4 encoding failed with exit code $LASTEXITCODE" }

    & $ffmpeg.Source -hide_banner -loglevel error -y -i $silentVideo -i $audioB -i $audioZ `
        -filter_complex "[1:a]adelay=0:all=1[a1];[2:a]adelay=3700:all=1[a2];[a1][a2]amix=inputs=2:normalize=0:duration=longest[a]" `
        -map 0:v:0 -map "[a]" -c:v copy -c:a aac -b:a 160k -t 7 -movflags +faststart $videoFile
    if ($LASTEXITCODE -ne 0) { throw "Audio mux failed with exit code $LASTEXITCODE" }

    & $ffmpeg.Source -hide_banner -loglevel error -y -i $videoFile `
        -vf "select='eq(n,0)+eq(n,8)+eq(n,47)+eq(n,88)+eq(n,89)+eq(n,95)+eq(n,119)+eq(n,167)',scale=360:-1,tile=4x2:nb_frames=8" `
        -vsync 0 -frames:v 1 (Join-Path $outputDir 'contact-sheet-v1-2d-camera.jpg')
    if ($LASTEXITCODE -ne 0) { throw "Contact sheet failed with exit code $LASTEXITCODE" }

    $probeJson = & $ffprobe.Source -v error -show_entries 'format=duration:stream=index,codec_name,codec_type,width,height,r_frame_rate,nb_frames' -of json $videoFile
    if ($LASTEXITCODE -ne 0) { throw "FFprobe failed with exit code $LASTEXITCODE" }
    $probeFile = Join-Path $outputDir 'ffprobe-v1-2d-camera.json'
    [System.IO.File]::WriteAllText($probeFile, ($probeJson -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))
    $probe = ($probeJson -join "`n") | ConvertFrom-Json
    $videoStream = $probe.streams | Where-Object { $_.codec_type -eq 'video' } | Select-Object -First 1
    $audioStream = $probe.streams | Where-Object { $_.codec_type -eq 'audio' } | Select-Object -First 1
    if (-not $videoStream -or -not $audioStream -or $videoStream.width -ne 960 -or $videoStream.height -ne 540 -or $videoStream.nb_frames -ne '168') {
        throw "Final media evaluation failed. See $probeFile"
    }
}

Write-Output "BLEND=$blendFile"
Write-Output "REPORT=$reportFile"
Write-Output "PLACEMENT=$placementFile"
if (-not $QualityControlOnly) { Write-Output "VIDEO=$videoFile" }
