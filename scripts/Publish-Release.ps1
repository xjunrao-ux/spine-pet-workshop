[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,
    [string]$ArtifactDirectory = 'release'
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
    $setupName = "Spine-Pet-Workshop-Setup-$tag-x64.exe"
    $portableName = "Spine-Pet-Workshop-Portable-$tag-x64.exe"
    $artifactRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $ArtifactDirectory))
    if (-not $artifactRoot.StartsWith($projectRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'ArtifactDirectory must be inside the project.'
    }
    $setup = Join-Path $artifactRoot $setupName
    $portable = Join-Path $artifactRoot $portableName
    $notes = Join-Path $projectRoot "docs/RELEASE_$tag.md"
    $series = ($Version.Split('.')[0..1] -join '.')
    $usage = Join-Path $projectRoot "docs/versions/v$series.md"
    foreach ($required in @($setup, $portable, $notes, $usage)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing release file: $required" }
    }
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

    $checksumPath = Join-Path $artifactRoot 'SHA256SUMS.txt'
    $checksumLines = foreach ($artifact in @($portable, $setup)) {
        $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $artifact
        "$($hash.Hash)  $([System.IO.Path]::GetFileName($artifact))"
    }
    [System.IO.File]::WriteAllLines($checksumPath, [string[]]$checksumLines, [System.Text.UTF8Encoding]::new($false))

    $usageArtifact = Join-Path $artifactRoot ([string]::Concat([char]0x4F7F, [char]0x7528, [char]0x8BF4, [char]0x660E, '.md'))
    Copy-Item -LiteralPath $usage -Destination $usageArtifact -Force

    git push --atomic --set-upstream public main "refs/tags/$tag"
    if ($LASTEXITCODE -ne 0) { throw 'Push failed; Release was not created.' }
    gh release create $tag $setup $portable $checksumPath $usageArtifact --repo xjunrao-ux/spine-pet-workshop --verify-tag --title "Spine Pet Workshop $tag" --notes-file $notes --latest
    if ($LASTEXITCODE -ne 0) { throw 'Release upload failed. Inspect GitHub before retrying.' }
} finally {
    Pop-Location
}
