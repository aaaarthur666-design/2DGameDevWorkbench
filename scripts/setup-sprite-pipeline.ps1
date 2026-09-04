[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pipelineRoot = Join-Path $repositoryRoot 'Tools\SpritePipeline'
$requirementsPath = Join-Path $pipelineRoot 'requirements.txt'
$requirementsLockPath = Join-Path $pipelineRoot 'requirements.lock'
$virtualEnvironment = Join-Path $pipelineRoot '.venv'
$virtualEnvironmentPython = Join-Path $virtualEnvironment 'Scripts\python.exe'

if (-not (Test-Path -LiteralPath $requirementsPath -PathType Leaf)) {
    throw "Sprite pipeline requirements were not found: $requirementsPath"
}

$pythonCandidates = [System.Collections.Generic.List[string]]::new()
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (Test-Path -LiteralPath $bundledPython -PathType Leaf) {
    $pythonCandidates.Add($bundledPython)
}

$pathPython = Get-Command python -ErrorAction SilentlyContinue
if (
    $null -ne $pathPython -and
    $pathPython.Source -notlike '*\Microsoft\WindowsApps\python.exe'
) {
    $pythonCandidates.Add($pathPython.Source)
}

$selectedPython = $null
$selectedVersion = $null
foreach ($candidate in @($pythonCandidates | Select-Object -Unique)) {
    Write-Verbose "Checking Python candidate: $candidate"
    try {
        $candidateVersionText = & $candidate -c 'import sys; print(sys.version_info[0], sys.version_info[1], sys.version_info[2], sep=chr(46))' 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Verbose "Candidate exited with code $LASTEXITCODE"
            continue
        }
        $candidateVersion = [version]$candidateVersionText.Trim()
        Write-Verbose "Candidate version: $candidateVersion"
        if ($candidateVersion -ge [version]'3.11') {
            $selectedPython = $candidate
            $selectedVersion = $candidateVersion
            break
        }
    }
    catch {
        Write-Verbose "Candidate failed: $($_.Exception.Message)"
        continue
    }
}

if ($null -eq $selectedPython) {
    throw 'Python 3.11 or newer was not found. Install Python or set up the Codex bundled runtime first.'
}

if (-not (Test-Path -LiteralPath $virtualEnvironmentPython -PathType Leaf)) {
    & $selectedPython -m venv $virtualEnvironment
    if ($LASTEXITCODE -ne 0) {
        throw "Creating the sprite pipeline virtual environment exited with code $LASTEXITCODE"
    }
}

$installRequirementsPath = if (Test-Path -LiteralPath $requirementsLockPath -PathType Leaf) {
    $requirementsLockPath
}
else {
    $requirementsPath
}

& $virtualEnvironmentPython -m pip install --disable-pip-version-check --requirement $installRequirementsPath
if ($LASTEXITCODE -ne 0) {
    throw "Installing sprite pipeline dependencies exited with code $LASTEXITCODE"
}

Write-Output "Sprite pipeline is ready with Python ${selectedVersion}: $virtualEnvironmentPython"
