[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,
    [string]$ArtifactDirectory = "release/v$Version",
    [string[]]$PluginArchives = @(),
    [string[]]$AdditionalAssets = @()
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    if ((git branch --show-current) -ne 'main') { throw 'Publish from main, after preparing a formal release commit.' }
    if ($LASTEXITCODE -ne 0) { throw 'Git repository unavailable.' }
    if (git status --porcelain) { throw 'Commit or resolve worktree changes before publishing.' }
    $package = Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json
    if ($package.version -ne $Version) { throw 'Version must match package.json.' }
    if (git rev-list HEAD -- v3) { throw 'main contains local research history. Prepare a squash release first.' }
    foreach ($file in (git ls-files)) {
        if ($file -match '^(v3|\.local|artifacts|node_modules|release|releases|pet-source|vendor|public-repos|public/models|public/voicepacks)/') {
            throw "Local-only file included in main: $file"
        }
    }
    gh auth status
    if ($LASTEXITCODE -ne 0) { throw 'Log in with gh auth login first.' }
    $remote = git remote get-url public
    if ($remote -ne 'https://github.com/xjunrao-ux/spine-pet-workshop.git') {
        throw 'Unexpected public remote. Review the repository before publishing.'
    }

    $tag = "v$Version"
    $setupName = "SpinePet-Setup-$tag-x64.exe"
    $portableName = "SpinePet-Portable-$tag-x64.exe"
    $artifactRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $ArtifactDirectory))
    if (-not $artifactRoot.StartsWith($projectRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'ArtifactDirectory must be inside the project.'
    }
    $setup = Join-Path $artifactRoot $setupName
    $portable = Join-Path $artifactRoot $portableName
    $notes = Join-Path $projectRoot "docs/RELEASE_$tag.md"
    $series = ($Version.Split('.')[0..1] -join '.')
    $usage = Join-Path $projectRoot "docs/versions/v$Version.md"
    if (-not (Test-Path -LiteralPath $usage -PathType Leaf)) { $usage = Join-Path $projectRoot "docs/versions/v$series.md" }
    foreach ($required in @($setup, $portable, $notes, $usage)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing release file: $required" }
    }
    $plugins = @(foreach ($archive in $PluginArchives) {
        $full = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $archive))
        if (-not $full.StartsWith($projectRoot + '\', [System.StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetExtension($full) -ne '.zip') {
            throw 'PluginArchives must name ZIP files inside the project.'
        }
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Missing plugin: $full" }
        node scripts/inspect-release-plugin.mjs $full | Write-Host
        if ($LASTEXITCODE -ne 0) { throw "Invalid plugin ZIP: $full" }
        $full
    })
    $extras = @(foreach ($asset in $AdditionalAssets) {
        $full = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $asset))
        if (-not $full.StartsWith($projectRoot + '\', [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
            throw "Additional asset must be a file inside the project: $asset"
        }
        $full
    })
    $existing = gh release list --repo xjunrao-ux/spine-pet-workshop --limit 100 --json tagName | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Could not read existing releases.' }
    if ($tag -in @($existing | ForEach-Object { $_.tagName })) { throw 'Release already exists; use a new version instead of replacing it.' }
    $tagCommit = git rev-parse -q --verify "refs/tags/$tag^{commit}" 2>$null
    if ($LASTEXITCODE -eq 0) {
        if ($tagCommit -ne (git rev-parse HEAD)) { throw 'Existing tag refers to a different commit.' }
    } else {
        git tag -a $tag -m "Spine Pet Workshop $tag"
        if ($LASTEXITCODE -ne 0) { throw 'Could not create release tag.' }
    }

    $usageArtifact = Join-Path $artifactRoot "USAGE-$tag.md"
    Copy-Item -LiteralPath $usage -Destination $usageArtifact -Force
    $attachments = @($portable, $setup, $usageArtifact) + @($plugins) + @($extras)
    if (@($attachments | ForEach-Object { [System.IO.Path]::GetFileName($_) } | Sort-Object -Unique).Count -ne $attachments.Count) { throw 'Release asset names must be unique.' }
    $checksumPath = Join-Path $artifactRoot 'SHA256SUMS.txt'
    $checksumLines = foreach ($artifact in $attachments) {
        $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $artifact
        "$($hash.Hash)  $([System.IO.Path]::GetFileName($artifact))"
    }
    [System.IO.File]::WriteAllLines($checksumPath, [string[]]$checksumLines, [System.Text.UTF8Encoding]::new($false))

    git push --atomic --set-upstream public main "refs/tags/$tag"
    if ($LASTEXITCODE -ne 0) { throw 'Push failed; Release was not created.' }
    $assets = @($attachments) + @($checksumPath)
    gh release create $tag @assets --repo xjunrao-ux/spine-pet-workshop --verify-tag --title "SpinePet $tag" --notes-file $notes --draft
    if ($LASTEXITCODE -ne 0) { throw 'Release upload failed. Inspect GitHub before retrying.' }
    gh release edit $tag --repo xjunrao-ux/spine-pet-workshop --draft=false --latest
    if ($LASTEXITCODE -ne 0) { throw 'Assets uploaded, but publishing the draft failed. Inspect GitHub before retrying.' }
} finally {
    Pop-Location
}
