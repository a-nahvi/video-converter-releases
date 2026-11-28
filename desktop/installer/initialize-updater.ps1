[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$publisher = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'VideoConverter.Publisher'
$protected = Join-Path $publisher 'signing-key.dpapi'
$publicKey = Join-Path $publisher 'signing-key.pub'
$configPath = Join-Path $PSScriptRoot '../src-tauri/tauri.conf.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -AsHashtable
$pinnedKey = $config.plugins.updater.pubkey

if (!(Test-Path -LiteralPath $protected -PathType Leaf) -or !(Test-Path -LiteralPath $publicKey -PathType Leaf)) {
    if ($pinnedKey -or (Test-Path -LiteralPath $protected) -or (Test-Path -LiteralPath $publicKey)) {
        throw 'The pinned signing identity is incomplete. Restore its key files before signing a release.'
    }
    New-Item -ItemType Directory -Path $publisher -Force | Out-Null
    $temporary = Join-Path $publisher ('.key-' + [Guid]::NewGuid().ToString('N'))
    try {
        # Keep the generator output off the console and protect the private key with Windows DPAPI.
        $null = & cargo tauri signer generate --ci --write-keys $temporary 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'Tauri could not generate the signing identity.' }
        $secret = ConvertTo-SecureString ([IO.File]::ReadAllText($temporary).Trim()) -AsPlainText -Force
        $secret | ConvertFrom-SecureString | Set-Content -LiteralPath $protected -Encoding ascii
        Copy-Item -LiteralPath ($temporary + '.pub') -Destination $publicKey
    } finally {
        foreach ($file in @($temporary, ($temporary + '.pub'))) {
            if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file -Force }
        }
    }
}

$key = ([IO.File]::ReadAllText($publicKey)).Trim()
if ($pinnedKey -and $pinnedKey -ne $key) { throw 'The local signing identity does not match the key pinned in the app.' }
if (!$pinnedKey) {
    if (!$config.plugins) { $config.plugins = @{} }
    $config.plugins.updater = @{
        pubkey = $key
        requireSignedVersion = $true
        windows = @{ installMode = 'passive' }
    }
    $config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $configPath -Encoding utf8
}
Write-Output "Pinned the update public key. Protected signing files are in $publisher."
