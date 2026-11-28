[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'github-repository.txt') -Raw).Trim()
if ($repository -notmatch '^[a-zA-Z0-9-]+/[a-zA-Z0-9_.-]+$') { throw 'Set the GitHub repository in github-repository.txt.' }
$owner = $repository.Split('/')[0]
$api = 'https://api.github.com'
$repoUrl = "$api/repos/$repository"
$token = $env:GH_TOKEN
if (!$token) {
    $previous = $env:GCM_INTERACTIVE
    try {
        $env:GCM_INTERACTIVE = 'Never'
        $credentialRequest = @('protocol=https', 'host=github.com', "username=$owner", '', '') -join "`n"
        $credential = $credentialRequest | git credential-manager get
        if ($LASTEXITCODE -ne 0) { throw 'Git Credential Manager could not read the saved GitHub sign-in.' }
        $password = $credential | Where-Object { $_.StartsWith('password=') } | Select-Object -First 1
        if ($password) { $token = $password.Substring(9) }
    } finally { $env:GCM_INTERACTIVE = $previous }
}
if (!$token) { throw "Sign in to GitHub as $owner with Git Credential Manager, or supply a publisher GH_TOKEN locally." }
$headers = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2026-03-10' }

function Invoke-GitHubApi {
    param([string]$Uri, [string]$Method = 'Get', $Body, [string]$AssetFile, [int[]]$Expected = @(200))
    $timeout = if ($AssetFile) { 600 } else { 30 }
    $request = @{ Uri = $Uri; Method = $Method; Headers = $headers; UserAgent = 'VideoConverter-Publisher'; TimeoutSec = $timeout; MaximumRedirection = 0; SkipHttpErrorCheck = $true }
    if ($AssetFile) {
        $request.InFile = $AssetFile
        $request.ContentType = 'application/octet-stream'
    } elseif ($null -ne $Body) {
        $request.Body = $Body | ConvertTo-Json -Depth 10 -Compress
        $request.ContentType = 'application/json; charset=utf-8'
    }
    $data = Invoke-RestMethod @request -StatusCodeVariable responseCode
    if ($responseCode -notin $Expected) { throw "GitHub $Method $([Uri]::new($Uri).AbsolutePath) returned HTTP $responseCode." }
    [pscustomobject]@{ Status = $responseCode; Body = $data }
}

$account = (Invoke-GitHubApi "$api/user").Body
if ($account.login -ne $owner) { throw "The active GitHub account must be $owner." }
$repo = (Invoke-GitHubApi $repoUrl).Body
if ($repo.visibility -ne 'public' -or $repo.full_name -ne $repository) { throw 'The destination must be the configured public release repository.' }

$dist = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../dist')).Path
$manifestPath = Join-Path $dist 'latest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'The release manifest must have a stable version.' }
$tag = "v$version"
$installerName = "VideoConverter-$version-windows-x64-setup.exe"
$installer = (Get-Item -LiteralPath (Join-Path $dist $installerName)).FullName
$signature = (Get-Content -LiteralPath ($installer + '.sig') -Raw).Trim()
$platform = $manifest.platforms.'windows-x86_64'
if ($platform.url -ne "https://github.com/$repository/releases/download/$tag/$installerName" -or $platform.signature -cne $signature -or !$signature) {
    throw 'Build the matching signed release before publishing it.'
}
$installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()

$releases = (Invoke-GitHubApi "$repoUrl/releases?per_page=100").Body
$release = $releases | Where-Object { $_.tag_name -eq $tag } | Select-Object -First 1
if (!$release) {
    Write-Output "Preparing the $tag release draft."
    $releaseBody = @'
## Download

[Download the Windows x64 installer]({0})

## What's changed

{1}

## Installer SHA-256

```text
{2}
```
'@ -f $platform.url, $manifest.notes, $installerHash
    $release = (Invoke-GitHubApi "$repoUrl/releases" -Method Post -Expected 201 -Body @{
        tag_name = $tag
        target_commitish = $repo.default_branch
        name = "Video Converter $version"
        body = $releaseBody
        draft = $true
    }).Body
}
foreach ($file in @($installer, $manifestPath)) {
    $assetName = Split-Path -Leaf $file
    $hash = if ($file -eq $installer) { $installerHash } else { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
    $digest = "sha256:$hash"
    $asset = $release.assets | Where-Object { $_.name -ceq $assetName } | Select-Object -First 1
    if ($asset -and $asset.state -eq 'uploaded' -and $asset.digest -eq $digest) { continue }
    if (!$release.draft) { throw "The published $tag release has a different $assetName. Build a new version." }
    if ($asset -and $asset.state -eq 'starter' -and $asset.size -eq 0) {
        $null = Invoke-GitHubApi "$repoUrl/releases/assets/$($asset.id)" -Method Delete -Expected 204
        $asset = $null
    }
    if ($asset) { throw "The $tag draft already contains a different $assetName." }
    $uploadUrl = "https://uploads.github.com/repos/$repository/releases/$($release.id)/assets?name=$([Uri]::EscapeDataString($assetName))"
    Write-Output "Uploading $assetName to the release draft."
    $uploaded = (Invoke-GitHubApi $uploadUrl -Method Post -Expected 201 -AssetFile $file).Body
    if ($uploaded.state -ne 'uploaded' -or $uploaded.digest -ne $digest) { throw "GitHub did not confirm the upload of $assetName." }
}
if ($release.draft) {
    $null = Invoke-GitHubApi "$repoUrl/releases/$($release.id)" -Method Patch -Body @{ draft = $false; make_latest = 'true' }
}
$latest = (Invoke-GitHubApi "$repoUrl/releases/latest").Body
if ($latest.tag_name -ne $tag -or $latest.draft -or $latest.prerelease) { throw "GitHub did not mark $tag as the latest stable release." }
Write-Output "Published ${tag}: $($latest.html_url)"
