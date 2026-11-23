[CmdletBinding()]
param(
  [switch]$Prepare,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

function Select-CanonicalRelease {
  param([object[]]$Releases)
  $ranked = foreach ($candidate in $Releases) {
    $names = @($candidate.assets | ForEach-Object { $_.name })
    [pscustomobject]@{
      Release = $candidate
      CompleteCore = [int]($names -contains 'MN-Game-Downloader-Setup.exe' -and $names -contains 'latest.yml')
      AssetCount = $names.Count
      Created = [string]$candidate.created_at
    }
  }
  $chosen = $ranked |
    Sort-Object -Property @{ Expression = { $_.CompleteCore }; Descending = $true },
                         @{ Expression = { $_.AssetCount }; Descending = $true },
                         @{ Expression = { $_.Created }; Descending = $true } |
    Select-Object -First 1
  if (-not $chosen) { return $null }
  return $chosen.Release
}

if ($SelfTest) {
  $fixtures = @(
    [pscustomobject]@{
      id = 10
      created_at = '2026-11-23T07:12:10Z'
      assets = @(
        [pscustomobject]@{ name = 'MN-Game-Downloader-Setup.exe' },
        [pscustomobject]@{ name = 'latest.yml' }
      )
    },
    [pscustomobject]@{
      id = 11
      created_at = '2026-11-23T07:12:11Z'
      assets = @([pscustomobject]@{ name = 'MN-Game-Downloader-Setup.exe.blockmap' })
    }
  )
  $selected = Select-CanonicalRelease -Releases $fixtures
  if ($selected.id -ne 10) { throw 'Release canonical-selection self-test failed.' }
  Write-Output 'Release finalizer self-test passed: canonical release selection.'
  exit 0
}

$version = (node -p "require('./package.json').version").Trim()
$tag = "v$version"
$repo = $env:GITHUB_REPOSITORY
$token = $env:GH_TOKEN
if (-not $repo) { throw 'GITHUB_REPOSITORY is missing.' }
if (-not $token) { throw 'GH_TOKEN is missing.' }

$apiBase = "https://api.github.com/repos/$repo"
$headers = @{
  Authorization = "Bearer $token"
  Accept = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent' = 'MN-Game-Downloader-release-finalizer'
}
$downloadHeaders = @{
  Authorization = "Bearer $token"
  Accept = 'application/octet-stream'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent' = 'MN-Game-Downloader-release-finalizer'
}

function Get-TagReleases {
  $all = Invoke-RestMethod -Method Get -Uri "$apiBase/releases?per_page=100" -Headers $headers
  return @($all | Where-Object { $_.tag_name -eq $tag })
}

function Move-ReleaseAssetsToCanonical {
  param(
    [Parameter(Mandatory = $true)][object]$Canonical,
    [Parameter(Mandatory = $true)][object[]]$Duplicates
  )
  $knownNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($asset in @($Canonical.assets)) { [void]$knownNames.Add([string]$asset.name) }

  foreach ($duplicate in $Duplicates) {
    $fullDuplicate = Invoke-RestMethod -Method Get -Uri "$apiBase/releases/$($duplicate.id)" -Headers $headers
    foreach ($asset in @($fullDuplicate.assets)) {
      if ($knownNames.Contains([string]$asset.name)) {
        Write-Output "Keeping canonical asset already present: $($asset.name)"
        continue
      }
      $safeName = [IO.Path]::GetFileName([string]$asset.name)
      if (-not $safeName -or $safeName -ne $asset.name) {
        throw "Unexpected release asset filename: $($asset.name)"
      }
      $tempPath = Join-Path ([IO.Path]::GetTempPath()) ("mn-release-" + [guid]::NewGuid().ToString('N') + "-" + $safeName)
      try {
        Invoke-WebRequest -Method Get -Uri $asset.url -Headers $downloadHeaders -OutFile $tempPath -UseBasicParsing
        $downloaded = Get-Item -LiteralPath $tempPath
        if ($downloaded.Length -ne [long]$asset.size) {
          throw "Downloaded asset size mismatch for $safeName."
        }
        if ($asset.digest -and $asset.digest.StartsWith('sha256:')) {
          $actualDigest = (Get-FileHash -LiteralPath $tempPath -Algorithm SHA256).Hash.ToLowerInvariant()
          $expectedDigest = $asset.digest.Substring(7).ToLowerInvariant()
          if ($actualDigest -ne $expectedDigest) {
            throw "Downloaded asset SHA-256 mismatch for $safeName."
          }
        }
        $encodedName = [uri]::EscapeDataString($safeName)
        $uploadUri = "https://uploads.github.com/repos/$repo/releases/$($Canonical.id)/assets?name=$encodedName"
        $uploaded = Invoke-RestMethod -Method Post -Uri $uploadUri -Headers $headers -ContentType 'application/octet-stream' -InFile $tempPath
        if ($uploaded.name -ne $safeName -or [long]$uploaded.size -ne [long]$asset.size -or $uploaded.state -ne 'uploaded') {
          throw "GitHub asset upload verification failed for $safeName."
        }
        [void]$knownNames.Add($safeName)
        Write-Output "Moved asset $safeName ($($uploaded.size) bytes) to canonical release."
      }
      finally {
        if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
      }
    }
    Invoke-RestMethod -Method Delete -Uri "$apiBase/releases/$($duplicate.id)" -Headers $headers | Out-Null
    Write-Output "Removed duplicate release record $($duplicate.id) after its unique assets were verified."
  }
}

$releases = @(Get-TagReleases)
if ($Prepare -and $releases.Count -eq 0) {
  $targetCommit = if ($env:GITHUB_SHA) { $env:GITHUB_SHA } else { 'main' }
  $payload = @{
    tag_name = $tag
    target_commitish = $targetCommit
    name = "MN Game Downloader $version"
    body = 'Windows desktop installer. Release validation includes regression tests and offline PostHog queue persistence.'
    draft = $true
    prerelease = $false
  } | ConvertTo-Json -Depth 5
  $created = Invoke-RestMethod -Method Post -Uri "$apiBase/releases" -Headers $headers -ContentType 'application/json' -Body $payload
  Write-Output "Created one draft release $tag before packaging (id $($created.id))."
  exit 0
}

if ($releases.Count -eq 0) {
  throw "No GitHub release record exists for $tag. Run the prepare step before packaging."
}

$canonical = Select-CanonicalRelease -Releases $releases
$duplicates = @($releases | Where-Object { $_.id -ne $canonical.id })
if ($duplicates.Count -gt 0) {
  Move-ReleaseAssetsToCanonical -Canonical $canonical -Duplicates $duplicates
}
$releases = @(Get-TagReleases)
if ($releases.Count -ne 1) {
  throw "Expected exactly one release for $tag after consolidation, found $($releases.Count)."
}
$canonical = $releases[0]

if ($Prepare) {
  Write-Output "One release record is ready for packaging: $($canonical.html_url)"
  exit 0
}

$requiredNames = @('MN-Game-Downloader-Setup.exe', 'MN-Game-Downloader-Setup.exe.blockmap', 'latest.yml')
$assetNames = @($canonical.assets | ForEach-Object { $_.name })
foreach ($requiredName in $requiredNames) {
  if ($assetNames -notcontains $requiredName) {
    throw "Required release asset is missing: $requiredName"
  }
}

$metadataAsset = $canonical.assets | Where-Object { $_.name -eq 'latest.yml' } | Select-Object -First 1
$metadataPath = Join-Path ([IO.Path]::GetTempPath()) ("mn-latest-" + [guid]::NewGuid().ToString('N') + ".yml")
try {
  Invoke-WebRequest -Method Get -Uri $metadataAsset.url -Headers $downloadHeaders -OutFile $metadataPath -UseBasicParsing
  $metadata = Get-Content -LiteralPath $metadataPath -Raw
  if ($metadata -notmatch "(?m)^version:\s*$([regex]::Escape($version))\s*$") {
    throw "latest.yml does not describe app version $version."
  }
  $sizeMatch = [regex]::Match($metadata, '(?m)^[ \t]+size:\s*(\d+)\s*$')
  $installerAsset = $canonical.assets | Where-Object { $_.name -eq 'MN-Game-Downloader-Setup.exe' } | Select-Object -First 1
  if (-not $sizeMatch.Success -or [long]$sizeMatch.Groups[1].Value -ne [long]$installerAsset.size) {
    throw 'latest.yml installer size does not match the uploaded Setup.exe.'
  }
}
finally {
  if (Test-Path -LiteralPath $metadataPath) { Remove-Item -LiteralPath $metadataPath -Force }
}

$latest = $null
try {
  $latest = Invoke-RestMethod -Method Get -Uri "$apiBase/releases/latest" -Headers $headers
} catch {
  $latest = $null
}

if ($canonical.draft -or -not $latest -or $latest.tag_name -ne $tag) {
  $publishPayload = @{
    draft = $false
    prerelease = $false
    make_latest = 'true'
    name = "MN Game Downloader $version"
    body = 'Windows installer built on GitHub Actions. Automated regression tests and offline PostHog queue persistence passed.'
  } | ConvertTo-Json -Depth 5
  $canonical = Invoke-RestMethod -Method Patch -Uri "$apiBase/releases/$($canonical.id)" -Headers $headers -ContentType 'application/json' -Body $publishPayload
}

$finalReleases = @(Get-TagReleases)
if ($finalReleases.Count -ne 1 -or $finalReleases[0].draft) {
  throw "Release $tag is not in a single, published state."
}
$final = Invoke-RestMethod -Method Get -Uri "$apiBase/releases/latest" -Headers $headers
if ($final.tag_name -ne $tag) { throw "The in-app updater's latest release is $($final.tag_name), expected $tag." }

Write-Output "Verified published release $tag at $($final.html_url)"
Write-Output "Verified assets: $($requiredNames -join ', ')"
