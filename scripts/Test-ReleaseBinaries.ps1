[CmdletBinding()]
param([string]$ArtifactDirectory = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
$names = @('PET_TEST_PROFILE','PET_CAPTURE_PATH','SETTINGS_CAPTURE_PATH','VITE_DEV_SERVER_URL','ELECTRON_RUN_AS_NODE')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
try {
  $package = Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json
  $version = $package.version
  if (-not $ArtifactDirectory) { $ArtifactDirectory = "release/v$version" }
  $artifactRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot $ArtifactDirectory))
  if (-not $artifactRoot.StartsWith($projectRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Artifacts must be inside the project.' }
  $validationRoot = Join-Path $projectRoot ".local/release-v$version-validation"
  New-Item -ItemType Directory -Path $validationRoot -Force | Out-Null
  foreach ($name in $names) { Remove-Item -LiteralPath ('Env:' + $name) -ErrorAction SilentlyContinue }
  $results = @()
  foreach ($case in @(
    @{name='unpacked-manager';exe='win-unpacked/SpinePet.exe';kind='manager'},
    @{name='unpacked-model';exe='win-unpacked/SpinePet.exe';kind='model'},
    @{name='portable-manager';exe="SpinePet-Portable-v$version-x64.exe";kind='manager'},
    @{name='portable-model';exe="SpinePet-Portable-v$version-x64.exe";kind='model'}
  )) {
    $profile = Join-Path $validationRoot ($case.name + '-profile-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $profile -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $profile 'feature-settings.json'),'{"schemaVersion":2,"global":{"theme":"graphite"},"plugins":{"workshop.music":{"enabled":false,"configVersion":1,"config":{}},"workshop.notifications":{"enabled":false,"configVersion":1,"config":{}},"example.todo":{"enabled":true,"configVersion":1,"config":{"reminders":false}}}}',[Text.UTF8Encoding]::new($false))
    $env:PET_TEST_PROFILE = $profile
    $capture = Join-Path $validationRoot ($case.name + '.png')
    if (Test-Path -LiteralPath $capture) { Remove-Item -LiteralPath $capture }
    $env:PET_CAPTURE_PATH = $null; $env:SETTINGS_CAPTURE_PATH = $null
    if ($case.kind -eq 'manager') { $env:SETTINGS_CAPTURE_PATH = $capture } else { $env:PET_CAPTURE_PATH = $capture }
    $exe = (Get-Item -LiteralPath (Join-Path $artifactRoot $case.exe)).FullName
    $process = Start-Process -FilePath $exe -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    for ($attempt=0; $attempt -lt 200; $attempt++) { if (Test-Path -LiteralPath $capture) { break }; Start-Sleep -Milliseconds 250 }
    if (-not (Test-Path -LiteralPath $capture)) { throw "Packaged capture missing: $($case.name)" }
    $process.WaitForExit(10000) | Out-Null
    if ((Get-Item -LiteralPath $capture).Length -lt 1000) { throw "Empty capture: $($case.name)" }
    $results += @{name=$case.name;ok=$true;image=(Split-Path -Leaf $capture);bytes=(Get-Item -LiteralPath $capture).Length}
    Write-Output "PASS $($case.name)"
  }
  $versions = @()
  foreach ($name in @("SpinePet-Setup-v$version-x64.exe","SpinePet-Portable-v$version-x64.exe")) {
    $file = Get-Item -LiteralPath (Join-Path $artifactRoot $name)
    if ($file.VersionInfo.ProductVersion -notlike "$version*") { throw "Unexpected artifact version: $name" }
    $versions += @{file=$name;version=$file.VersionInfo.ProductVersion;bytes=$file.Length}
  }
  @{ok=$true;version=$version;captures=$results;artifactVersions=$versions;installerScope='Version and package structure; no changes to user installation or registry.'} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $validationRoot 'binary-smoke.json') -Encoding utf8
} finally {
  foreach ($name in $names) { if ($null -eq $previous[$name]) { Remove-Item -LiteralPath ('Env:' + $name) -ErrorAction SilentlyContinue } else { [Environment]::SetEnvironmentVariable($name,$previous[$name],'Process') } }
  Pop-Location
}
