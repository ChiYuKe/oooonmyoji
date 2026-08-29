[CmdletBinding()]
param(
    [ValidateRange(0, 1000)][int]$KeepLatestRuns = 10,
    [switch]$ClearCaches,
    [switch]$Apply
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$artifactRoot = (Resolve-Path (Join-Path $projectRoot "artifacts")).Path

function Assert-DescendantPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Parent
    )

    $resolvedPath = [IO.Path]::GetFullPath($Path)
    $resolvedParent = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $prefix = $resolvedParent + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside '$resolvedParent': $resolvedPath"
    }
}

function Get-TreeBytes {
    param([Parameter(Mandatory = $true)][string]$Path)

    $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File -ErrorAction SilentlyContinue)
    return [long](($files | Measure-Object Length -Sum).Sum)
}

$workflowDirectories = @(
    Get-ChildItem -LiteralPath $artifactRoot -Directory |
        Where-Object { $_.Name -match '^workflow-[A-Za-z0-9]+-[A-Za-z0-9]+$' } |
        Sort-Object LastWriteTime -Descending
)
$recentRunNames = @($workflowDirectories | Select-Object -First $KeepLatestRuns | ForEach-Object { $_.Name })
$rewardRunNames = @(
    $workflowDirectories |
        Where-Object {
            @(Get-ChildItem -LiteralPath (Join-Path $_.FullName "rewards") -Filter "reward-*.png" -File -ErrorAction SilentlyContinue).Count -gt 0
        } |
        ForEach-Object { $_.Name }
)
$retainedRunNames = @($recentRunNames + $rewardRunNames | Sort-Object -Unique)
$retainedRuns = @($workflowDirectories | Where-Object { $_.Name -in $retainedRunNames })
$obsoleteRuns = @($workflowDirectories | Where-Object { $_.Name -notin $retainedRunNames })
$transientNames = @(
    "party-smoke",
    "reward-local-ocr-validation-v3",
    "reward-template-validation",
    "reward-template-validation-v2"
)
$transientDirectories = @(
    foreach ($name in $transientNames) {
        $path = Join-Path $artifactRoot $name
        if (Test-Path -LiteralPath $path -PathType Container) {
            Get-Item -LiteralPath $path
        }
    }
)
$duplicateFailureFrames = @(
    foreach ($directory in $retainedRuns) {
        Get-ChildItem -LiteralPath $directory.FullName -Filter "failure-*.png" -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ne "failure-last-frame.png" }
    }
)
$topLevelReferences = @(
    Get-ChildItem -LiteralPath $artifactRoot -File |
        Where-Object { $_.Extension -in @(".png", ".json") }
)
$partySetup = Join-Path $artifactRoot "party-setup"
$cacheDirectories = @()
if ($ClearCaches) {
    $cacheDirectories = @(
        foreach ($name in @(".mypy_cache", ".pytest_cache")) {
            $path = Join-Path $projectRoot $name
            if (Test-Path -LiteralPath $path -PathType Container) {
                Get-Item -LiteralPath $path
            }
        }
    )
}

$plannedBytes = [long](
    (($obsoleteRuns | ForEach-Object { Get-TreeBytes $_.FullName }) | Measure-Object -Sum).Sum +
    (($transientDirectories | ForEach-Object { Get-TreeBytes $_.FullName }) | Measure-Object -Sum).Sum +
    (($duplicateFailureFrames | Measure-Object Length -Sum).Sum) +
    (($cacheDirectories | ForEach-Object { Get-TreeBytes $_.FullName }) | Measure-Object -Sum).Sum
)

[pscustomobject]@{
    Mode = if ($Apply) { "apply" } else { "preview" }
    RetainedRunDirectories = $retainedRuns.Count
    ObsoleteRunDirectories = $obsoleteRuns.Count
    DuplicateFailureFrames = $duplicateFailureFrames.Count
    TransientDirectories = $transientDirectories.Count
    ReferenceFilesToArchive = $topLevelReferences.Count
    CacheDirectories = $cacheDirectories.Count
    EstimatedReclaimedMB = [math]::Round($plannedBytes / 1MB, 1)
} | Format-List

if (-not $Apply) {
    Write-Host "Preview only. Re-run with -Apply to perform the cleanup."
    exit 0
}

foreach ($directory in $obsoleteRuns + $transientDirectories) {
    Assert-DescendantPath -Path $directory.FullName -Parent $artifactRoot
    Remove-Item -LiteralPath $directory.FullName -Recurse -Force
}
foreach ($file in $duplicateFailureFrames) {
    Assert-DescendantPath -Path $file.FullName -Parent $artifactRoot
    Remove-Item -LiteralPath $file.FullName -Force
}

$referenceRoot = Join-Path $artifactRoot "reference"
$manualRoot = Join-Path $referenceRoot "manual-captures"
Assert-DescendantPath -Path $manualRoot -Parent $artifactRoot
New-Item -ItemType Directory -Path $manualRoot -Force | Out-Null
foreach ($file in $topLevelReferences) {
    $destination = Join-Path $manualRoot $file.Name
    if (Test-Path -LiteralPath $destination) {
        Write-Warning "Reference already archived, leaving source in place: $($file.FullName)"
        continue
    }
    Move-Item -LiteralPath $file.FullName -Destination $destination
}
if (Test-Path -LiteralPath $partySetup -PathType Container) {
    $destination = Join-Path $referenceRoot "party-setup"
    Assert-DescendantPath -Path $partySetup -Parent $artifactRoot
    Assert-DescendantPath -Path $destination -Parent $artifactRoot
    if (Test-Path -LiteralPath $destination) {
        Write-Warning "Party setup references are already archived, leaving source in place: $partySetup"
    }
    else {
        Move-Item -LiteralPath $partySetup -Destination $destination
    }
}

foreach ($directory in $cacheDirectories) {
    Assert-DescendantPath -Path $directory.FullName -Parent $projectRoot
    Remove-Item -LiteralPath $directory.FullName -Recurse -Force
}

Write-Host "Artifact cleanup completed."
