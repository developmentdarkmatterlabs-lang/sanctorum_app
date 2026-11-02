<#
  Builds docs/manual/Sanctorum_Manual.pdf from docs/manual/manual.html with Edge or Chrome (headless).
    -Screenshots          retake every picture first (scripts/manualShots.mjs), after rebuilding the app
    -Screenshots -Only a,b retake only those pictures ('art' redoes the cover art)
    -SkipBuild            take pictures without rebuilding the app first
#>
param(
  [switch]$Screenshots,
  [string[]]$Only,
  [switch]$SkipBuild
)
# Native tools are judged by their exit codes; Windows PowerShell would treat their stderr as errors.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$Manual = Join-Path $Root 'docs\manual'
$Pdf = Join-Path $Manual 'Sanctorum_Manual.pdf'

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw 'ffmpeg is required (it converts the pictures)' }

if ($Screenshots) {
  Push-Location $Root
  try {
    if (-not $SkipBuild) {
      npm run build:electron
      if ($LASTEXITCODE) { throw 'npm run build:electron failed' }
      npm run build:frontend
      if ($LASTEXITCODE) { throw 'npm run build:frontend failed' }
    }
    # VS Code and Cursor terminals set this, and Electron would then start as plain Node.
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    $nodeArgs = @('scripts/manualShots.mjs')
    if ($Only) { $nodeArgs += "--only=$($Only -join ',')" }
    node @nodeArgs
    if ($LASTEXITCODE) { throw 'taking the pictures failed' }
  }
  finally { Pop-Location }
}

$Browser = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $Browser) { throw 'Edge or Chrome is required to print the manual' }

# Printed from a temporary copy with JPEG pictures: Chrome embeds JPEGs as they are, but stores WebP losslessly.
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ('sanctorum-manual-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $Tmp -ErrorAction Stop | Out-Null
try {
  Copy-Item (Join-Path $Manual 'manual.html'), (Join-Path $Manual 'sanctorum_manual.css') $Tmp -ErrorAction Stop
  Copy-Item (Join-Path $Manual 'ornaments') -Destination (Join-Path $Tmp 'ornaments') -Recurse -ErrorAction Stop
  $Images = Join-Path $Tmp 'images'
  New-Item -ItemType Directory -Path $Images -ErrorAction Stop | Out-Null

  $html = Get-Content (Join-Path $Tmp 'manual.html') -Raw -Encoding UTF8 -ErrorAction Stop
  foreach ($f in Get-ChildItem (Join-Path $Manual 'images') -Filter *.webp) {
    # The portraits keep their transparency, so they go in as PNG.
    $ext = if ($f.BaseName -like 'portrait-*') { 'png' } else { 'jpg' }
    $out = Join-Path $Images "$($f.BaseName).$ext"
    # 1500 pixels is sharper than print needs at this size, and keeps the PDF small.
    $width = if ($f.BaseName -like 'floor-*') { 500 } else { 1500 }  # the floors print about 38 mm wide
    if ($ext -eq 'jpg') { ffmpeg -v error -y -i $f.FullName -vf "scale='min($width,iw)':-2" -q:v 4 $out } else { ffmpeg -v error -y -i $f.FullName $out }
    if ($LASTEXITCODE) { throw "could not convert $($f.Name)" }
    $html = $html.Replace("images/$($f.Name)", "images/$($f.BaseName).$ext")
  }
  Set-Content -Path (Join-Path $Tmp 'manual.html') -Value $html -Encoding UTF8 -ErrorAction Stop

  if (Test-Path $Pdf) { Remove-Item $Pdf }
  $url = 'file:///' + ((Join-Path $Tmp 'manual.html') -replace '\\', '/')
  $printArgs = @(
    '--headless=new', '--disable-gpu', '--no-first-run', "--user-data-dir=`"$(Join-Path $Tmp 'profile')`"",
    '--no-pdf-header-footer', '--print-to-pdf-no-header', '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=20000', "--print-to-pdf=`"$Pdf`"", "`"$url`""
  )
  Start-Process -FilePath $Browser -ArgumentList $printArgs -Wait -NoNewWindow
  if (-not (Test-Path $Pdf)) { throw 'the browser did not write the PDF' }
  $kb = [math]::Round((Get-Item $Pdf).Length / 1KB)
  Write-Host "Wrote docs\manual\Sanctorum_Manual.pdf ($kb KB)"
}
finally {
  Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
