[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"
$config = Join-Path $repoRoot "config\config.example.json"
$runDirectory = Join-Path $repoRoot "artifacts\runs"

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

function Assert-Condition {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if (-not $Condition) {
        throw "Acceptance check failed: $Message"
    }
}

Push-Location $repoRoot
try {
    Invoke-Checked "default pytest" @("-m", "pytest", "-q")
    Invoke-Checked "mypy" @("-m", "mypy", "src")
    Invoke-Checked "doctor" @("-m", "src.oooonmyoji.cli", "--config", ".\config\config.example.json", "doctor")

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

    $existingRunFiles = @()
    if (Test-Path -LiteralPath $runDirectory) {
        $existingRunFiles = @(Get-ChildItem -LiteralPath $runDirectory -Filter "*.json" -File | ForEach-Object { $_.FullName })
    }
    Invoke-Checked "real diagnostic JSON workflow" @(
        "-m", "src.oooonmyoji.cli", "--config", ".\config\config.example.json", "run", "diagnostic-mumu-0"
    )

    $runCandidates = @(Get-ChildItem -LiteralPath $runDirectory -Filter "*.json" -File |
        Where-Object { $existingRunFiles -notcontains $_.FullName } |
        Sort-Object LastWriteTime -Descending)
    if ($runCandidates.Count -eq 0) {
        $runCandidates = @(Get-ChildItem -LiteralPath $runDirectory -Filter "*.json" -File |
            Sort-Object LastWriteTime -Descending)
    }
    $runFile = $runCandidates | Select-Object -First 1
    Assert-Condition ($null -ne $runFile) "diagnostic workflow did not produce a run record"
    $record = $null
    for ($attempt = 0; $attempt -lt 10 -and $null -eq $record; $attempt++) {
        try {
            $recordJson = & $python -c "import json,sys; print(json.dumps(json.load(open(sys.argv[-1], encoding='utf-8')), ensure_ascii=True))" -- $runFile.FullName
            if ($LASTEXITCODE -ne 0) { throw "run record is not valid JSON yet" }
            $record = ($recordJson -join "`n") | ConvertFrom-Json
        }
        catch {
            if ($attempt -eq 9) { throw }
            Start-Sleep -Milliseconds 200
        }
    }
    Assert-Condition ($null -ne $record) "diagnostic run record could not be parsed"
    Assert-Condition ($record.status -eq "succeeded") "diagnostic workflow status is '$($record.status)'"
    Assert-Condition (-not [string]::IsNullOrWhiteSpace([string]$record.workflow_id)) "workflow_id is missing"
    Assert-Condition (-not [string]::IsNullOrWhiteSpace([string]$record.workflow_version)) "workflow_version is missing"
    Assert-Condition (-not [string]::IsNullOrWhiteSpace([string]$record.workflow_file_hash)) "workflow_file_hash is missing"
    Assert-Condition (-not [string]::IsNullOrWhiteSpace([string]$record.details.last_frame)) "last frame metadata is missing"
    Assert-Condition (Test-Path -LiteralPath ([string]$record.details.last_frame) -PathType Leaf) "last frame artifact is missing"

    $steps = @($record.step_history)
    Assert-Condition ($steps.Count -gt 0) "step_history is empty"
    foreach ($stepId in @("capture", "save_frame", "ocr")) {
        $step = $steps | Where-Object { $_.step_id -eq $stepId } | Select-Object -Last 1
        Assert-Condition ($null -ne $step) "step '$stepId' is missing"
        Assert-Condition ($step.status -eq "succeeded") "step '$stepId' did not succeed"
    }
    $conditionalStep = $steps | Where-Object { $_.step_id -eq "find_button" } | Select-Object -Last 1
    Assert-Condition ($null -ne $conditionalStep) "conditional template step is missing"
    Assert-Condition ($conditionalStep.status -in @("succeeded", "skipped")) "conditional template step has invalid status '$($conditionalStep.status)'"
    $clickSteps = @($steps | Where-Object { $_.action -in @("input.tap", "input.tap_match") })
    Assert-Condition ($clickSteps.Count -eq 0) "diagnostic workflow executed a click Action"

    $ocrResults = @($record.details.workflow_output.ocr)
    Assert-Condition ($ocrResults.Count -gt 0) "diagnostic OCR output is empty"
    $captureOutput = $record.details.workflow_output.capture
    $frameWidth = [int]$captureOutput.width
    $frameHeight = [int]$captureOutput.height
    foreach ($result in $ocrResults) {
        Assert-Condition ($result.text -is [string] -and -not [string]::IsNullOrWhiteSpace($result.text)) "OCR text is invalid"
        $confidence = [double]$result.confidence
        Assert-Condition ($confidence -ge 0 -and $confidence -le 1) "OCR confidence is outside [0,1]"
        $box = @($result.box)
        Assert-Condition ($box.Count -eq 4) "OCR result does not contain four box points"
        foreach ($point in $box) {
            $coordinates = @($point)
            Assert-Condition ($coordinates.Count -eq 2) "OCR box point is invalid"
            $x = [int]$coordinates[0]
            $y = [int]$coordinates[1]
            Assert-Condition ($x -ge 0 -and $x -lt $frameWidth -and $y -ge 0 -and $y -lt $frameHeight) "OCR box point is outside the captured frame"
        }
    }

    Invoke-Checked "native capture performance" @(
        "tests\tools\mumu_fast_benchmark.py", "--batches", "3", "--rounds", "30", "--warmup", "5"
    )

    Write-Host "`nACCEPTANCE PASS: all checks completed; run record $($runFile.FullName)" -ForegroundColor Green
}
finally {
    Pop-Location
}
