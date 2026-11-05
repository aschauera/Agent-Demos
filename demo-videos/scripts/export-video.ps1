# Exports the deck to a single MP4 (e.g. for LinkedIn) using PowerPoint's video renderer.
# Works on a timed copy so the presenter deck stays click-driven: cover = CoverSeconds, each scene slide = clip length + HoldSeconds.
param(
  [string]$Deck = 'deck\copilot-architecture-demo.pptx',
  [string]$Manifest = 'artifacts\manifest.json',
  [string]$Out = 'videos\linkedin\copilot-architecture-demo.mp4',
  [double]$CoverSeconds = 4,
  [double]$HoldSeconds = 1.5,
  [int]$TimeoutSeconds = 900
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$deckPath = Join-Path $root $Deck
$outPath = Join-Path $root $Out
$scenes = (Get-Content (Join-Path $root $Manifest) -Raw | ConvertFrom-Json).scenes
New-Item -ItemType Directory -Force (Split-Path $outPath) | Out-Null
$timed = Join-Path $env:TEMP "timed-$([guid]::NewGuid()).pptx"
$raw = "$outPath.ppt.mp4"
Copy-Item $deckPath $timed

$pp = New-Object -ComObject PowerPoint.Application
try {
  $p = $pp.Presentations.Open($timed, $false, $false, $false)
  for ($i = 1; $i -le $p.Slides.Count; $i++) {
    $t = $p.Slides($i).SlideShowTransition
    $t.AdvanceOnClick = 0
    $t.AdvanceOnTime = -1
    $t.EntryEffect = 1793 # ppEffectFade
    $t.Duration = 0.5
    if ($i -eq 1) { $t.AdvanceTime = $CoverSeconds; continue }
    $clip = ($scenes[$i - 2].shots | Measure-Object duration -Sum).Sum
    $t.AdvanceTime = [math]::Round($clip + $HoldSeconds, 2)
  }
  $p.Save()
  # UseTimingsAndNarrations, DefaultSlideDuration, VertResolution, FramesPerSecond, Quality
  $p.CreateVideo($raw, $true, 5, 1080, 30, 100)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  # ppMediaTaskStatus: 1 InProgress, 2 Queued, 3 Done, 4 Failed
  while ($p.CreateVideoStatus -in 1, 2) {
    if ((Get-Date) -gt $deadline) { throw 'PowerPoint video export timed out' }
    Start-Sleep 3
  }
  if ($p.CreateVideoStatus -ne 3) { throw "PowerPoint video export failed (status $($p.CreateVideoStatus))" }
  $p.Close()
} finally {
  $pp.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pp)
  Remove-Item $timed -ErrorAction SilentlyContinue
}

# Normalize for social upload: H.264 High, yuv420p, 30 fps, silent AAC track (some platforms reject video-only files), faststart.
ffmpeg -v error -y -i $raw -f lavfi -i anullsrc=r=48000:cl=stereo -map 0:v -map 1:a -shortest `
  -c:v libx264 -profile:v high -preset slow -crf 18 -pix_fmt yuv420p -r 30 -c:a aac -b:a 128k -movflags +faststart $outPath
if ($LASTEXITCODE -ne 0) { throw 'ffmpeg normalization failed' }
Remove-Item $raw
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration,size -of compact $outPath
