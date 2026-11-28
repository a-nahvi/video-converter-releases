[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$release = 'ffmpeg-9.1-essentials_build'
$distribution = "https://www.gyan.dev/ffmpeg/builds/packages/$release.7z"
$mirror = "https://github.com/GyanD/codexffmpeg/releases/download/9.1/$release.7z"
$sha256 = '835B9A733445BA7A56A37A26CF7BDE84E2F3CE7DA2A8EC984276BB2ABB1B922C'
$cache = New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot '.cache')
$archive = Join-Path $cache.FullName "$release.7z"

if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
    $partialArchive = "$archive.part"
    & curl.exe --fail --location --retry 2 --connect-timeout 20 --output $partialArchive $mirror
    if ($LASTEXITCODE -ne 0) {
        & curl.exe --fail --location --retry 2 --connect-timeout 20 --output $partialArchive $distribution
    }
    if ($LASTEXITCODE -ne 0) { throw 'Could not download FFmpeg from Gyan.dev.' }
    if ((Get-FileHash -LiteralPath $partialArchive -Algorithm SHA256).Hash -ne $sha256) {
        throw 'FFmpeg archive does not match the SHA-256 published by Gyan.dev.'
    }
    Move-Item -LiteralPath $partialArchive -Destination $archive -Force
} elseif ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $sha256) {
    throw "Unexpected FFmpeg archive checksum: $archive"
}

$items = @('bin/ffmpeg.exe', 'bin/ffprobe.exe', 'LICENSE', 'README.txt')
$archiveItems = $items | ForEach-Object { "$release/$_" }
& tar.exe -xf $archive -C $cache.FullName @archiveItems
if ($LASTEXITCODE -ne 0) { throw 'Could not extract the FFmpeg runtime.' }

$source = Join-Path $cache.FullName $release
$destination = New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot '../src-tauri/ffmpeg')
foreach ($item in $items) {
    $destinationFile = Join-Path $destination.FullName (Split-Path -Leaf $item)
    Move-Item -LiteralPath (Join-Path $source $item) -Destination $destinationFile -Force
}

@"
FFmpeg 9.1 Windows x64 essentials build by Gyan Doshi
License: GNU General Public License version 3 (see LICENSE)

Original builds: https://github.com/GyanD/codexffmpeg/releases/tag/9.1
Archive: $distribution
Published SHA-256: $distribution.sha256
$sha256

FFmpeg source revision: https://github.com/FFmpeg/FFmpeg/commit/74e4393595
FFmpeg source archive: https://github.com/FFmpeg/FFmpeg/archive/74e4393595.tar.gz
Libraries in this build: https://www.gyan.dev/ffmpeg/builds/#libraries
The original build configuration is described in the vendor's README.txt.
"@ | Set-Content -LiteralPath (Join-Path $destination.FullName 'SOURCE.txt') -Encoding UTF8

Write-Output "Prepared verified FFmpeg 9.1 runtime in $($destination.FullName)"
