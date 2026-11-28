[CmdletBinding()]
param([string]$Notes = 'نسخهٔ تازهٔ مبدل ویدیو')

$ErrorActionPreference = 'Stop'
$tauri = Join-Path $PSScriptRoot '../src-tauri'
$dist = Join-Path $PSScriptRoot '../dist'
$signer = Join-Path $PSScriptRoot 'signer'
$publisher = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'VideoConverter.Publisher'
$keyFile = Join-Path $publisher 'signing-key.dpapi'
$config = Get-Content -LiteralPath (Join-Path $tauri 'tauri.conf.json') -Raw | ConvertFrom-Json
$version = $config.version
$repository = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'github-repository.txt') -Raw).Trim()
$publicKey = $config.plugins.updater.pubkey
if (!$publicKey -or $repository -notmatch '^[a-zA-Z0-9-]+/[a-zA-Z0-9_.-]+$' -or !(Test-Path -LiteralPath $keyFile -PathType Leaf)) {
    throw 'Configure the GitHub repository and restore the publisher signing identity before building a release.'
}

Push-Location $tauri
try {
    cargo tauri build --no-bundle --ci -- --locked
    if ($LASTEXITCODE -ne 0) { throw 'The release application build failed.' }
    cargo tauri bundle --bundles nsis --config tauri.bundle.json --ci --no-sign
    if ($LASTEXITCODE -ne 0) { throw 'The NSIS package build failed.' }
} finally { Pop-Location }

cargo build --locked --release --manifest-path (Join-Path $signer 'Cargo.toml')
if ($LASTEXITCODE -ne 0) { throw 'The release signer build failed.' }

$installerName = "VideoConverter-$version-windows-x64-setup.exe"
$installer = Join-Path $dist $installerName
$bundle = Join-Path $tauri "target/release/bundle/nsis/Video Converter_$($version)_x64-setup.exe"
New-Item -ItemType Directory -Path $dist -Force | Out-Null
Copy-Item -LiteralPath $bundle -Destination $installer -Force

$secure = (Get-Content -LiteralPath $keyFile -Raw).Trim() | ConvertTo-SecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$previousPrivate = $env:TAURI_SIGNING_PRIVATE_KEY
$previousPublic = $env:VC_UPDATER_PUBLIC_KEY
try {
    $env:TAURI_SIGNING_PRIVATE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $env:VC_UPDATER_PUBLIC_KEY = $publicKey
    & (Join-Path $signer 'target/release/video-converter-release-signer.exe') $installer $version
    if ($LASTEXITCODE -ne 0) { throw 'The versioned update signature failed.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $env:TAURI_SIGNING_PRIVATE_KEY = $previousPrivate
    $env:VC_UPDATER_PUBLIC_KEY = $previousPublic
}

$signature = (Get-Content -LiteralPath ($installer + '.sig') -Raw).Trim()
$manifest = [ordered]@{
    version = $version
    notes = $Notes
    platforms = [ordered]@{
        'windows-x86_64' = [ordered]@{ signature = $signature; url = "https://github.com/$repository/releases/download/v$version/$installerName" }
    }
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $dist 'latest.json') -Encoding utf8
Write-Output "Release $version is ready in $dist for publish-github-release.ps1."
