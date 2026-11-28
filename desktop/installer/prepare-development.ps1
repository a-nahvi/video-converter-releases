[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
if (!$IsWindows) { throw 'Run this script in PowerShell 7 on Windows.' }

Add-Type -AssemblyName System.Drawing
$iconDirectory = New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot '../src-tauri/icons')
$windowsIcon = [System.Drawing.SystemIcons]::Application
$ico = Join-Path $iconDirectory.FullName 'icon.ico'
if (!(Test-Path -LiteralPath $ico -PathType Leaf)) {
    $file = [System.IO.File]::Open($ico, [System.IO.FileMode]::CreateNew)
    try { $windowsIcon.Save($file) }
    finally { $file.Dispose() }
}

$png = Join-Path $iconDirectory.FullName 'icon.png'
if (!(Test-Path -LiteralPath $png -PathType Leaf)) {
    $bitmap = $windowsIcon.ToBitmap()
    try { $bitmap.Save($png, [System.Drawing.Imaging.ImageFormat]::Png) }
    finally { $bitmap.Dispose() }
}

$headerIcon = Join-Path $PSScriptRoot '../frontend/vendor/app-icon.png'
if (!(Test-Path -LiteralPath $headerIcon -PathType Leaf)) {
    Copy-Item -LiteralPath $png -Destination $headerIcon
}
