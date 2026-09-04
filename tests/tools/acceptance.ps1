[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"
$config = Join-Path $repoRoot "config\config.example.json"

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw "Python virtual environment was not found: $python"
}
if (-not (Test-Path -LiteralPath $config -PathType Leaf)) {
    throw "Acceptance config was not found: $config"
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    & $python @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

function Invoke-Node-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    Push-Location $WorkingDirectory
    try {
        & npm @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$Name failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

Push-Location $repoRoot
try {
    Invoke-Checked "default pytest" @("-m", "pytest", "-q")
    Invoke-Checked "mypy" @("-m", "mypy", "src")
    Invoke-Checked "doctor" @("-m", "src.oooonmyoji.cli", "--config", ".\config\config.example.json", "doctor")
    Invoke-Checked "Python/TypeScript contract check" @("tests\contract_check.py")

    Invoke-Node-Checked "desktop TypeScript and renderer build" (Join-Path $repoRoot "desktop") @("run", "build")
    Invoke-Node-Checked "VS Code TypeScript build" (Join-Path $repoRoot "vscode-onmyoji-workflow") @("exec", "tsc", "-p", "tsconfig.json")
    Invoke-Node-Checked "VS Code Node smoke" (Join-Path $repoRoot "vscode-onmyoji-workflow") @("tests\smoke.js")
    Invoke-Node-Checked "VS Code DOM smoke" (Join-Path $repoRoot "vscode-onmyoji-workflow") @("tests\editor-dom-smoke.js")
    Invoke-Node-Checked "VS Code run-log DOM smoke" (Join-Path $repoRoot "vscode-onmyoji-workflow") @("tests\run-log-dom-smoke.js")

    $oldRealOcr = $env:OOOONMYOJI_RUN_REAL_OCR
    $oldRealDevices = $env:OOOONMYOJI_RUN_REAL_DEVICES
    try {
        $env:OOOONMYOJI_RUN_REAL_OCR = "1"
        Invoke-Checked "live MuMu OCR" @("-m", "pytest", "tests\test_vision_ocr.py", "-q")

        $env:OOOONMYOJI_RUN_REAL_DEVICES = "1"
        Invoke-Checked "two real ADB instances" @(
            "-m", "pytest", "tests\test_supervisor_integration.py::test_supervisor_runs_two_real_adb_instances", "-q"
        )
    }
    finally {
        if ($null -eq $oldRealOcr) { Remove-Item Env:OOOONMYOJI_RUN_REAL_OCR -ErrorAction SilentlyContinue } else { $env:OOOONMYOJI_RUN_REAL_OCR = $oldRealOcr }
        if ($null -eq $oldRealDevices) { Remove-Item Env:OOOONMYOJI_RUN_REAL_DEVICES -ErrorAction SilentlyContinue } else { $env:OOOONMYOJI_RUN_REAL_DEVICES = $oldRealDevices }
    }

    Invoke-Checked "native capture performance" @(
        "tests\tools\mumu_fast_benchmark.py", "--batches", "3", "--rounds", "30", "--warmup", "5"
    )

    Write-Host "`nACCEPTANCE PASS: all checks completed" -ForegroundColor Green
}
finally {
    Pop-Location
}
