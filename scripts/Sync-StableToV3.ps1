param([string]$Source = "dev/v2.3.1")
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
  if ($Source -ne "main" -and $Source -notmatch '^dev/v2\.[0-9]+(\.[0-9]+)?$') { throw "Only main or a local dev/v2.x[.x] branch can be synchronized." }
  if (git status --porcelain) { throw "Save and commit your changes before syncing." }
  git show-ref --verify --quiet "refs/heads/$Source"
  if ($LASTEXITCODE -ne 0) { throw "Source branch does not exist: $Source" }
  git show-ref --verify --quiet refs/heads/dev/v3
  if ($LASTEXITCODE -ne 0) { throw "Local dev/v3 branch does not exist." }
  if ((git branch --show-current) -eq "") { throw "Do not sync from a detached HEAD." }
  git switch dev/v3
  if ($LASTEXITCODE -ne 0) { throw "Unable to switch to dev/v3." }
  git merge --no-ff --no-edit $Source
  if ($LASTEXITCODE -ne 0) { throw "Merge needs manual resolution. Preserve the v3 version and features, resolve conflicts, then git add and git commit. Nothing was pushed." }
  pnpm build
  if ($LASTEXITCODE -ne 0) { throw "Merge completed locally, but build failed. Fix and test before continuing v3 development." }
  Write-Host "Stable fixes merged and build passed. Current branch: dev/v3. No push or release performed."
} finally { Pop-Location }
