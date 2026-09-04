[CmdletBinding()]
param(
    [ValidateSet('ui', 'api')]
    [string] $Mode = 'ui'
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pipelineRoot = Join-Path $repositoryRoot 'Tools\SpritePipeline'
$pipelineCli = Join-Path $pipelineRoot 'cli.py'
$pipelinePython = Join-Path $pipelineRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $pipelinePython -PathType Leaf)) {
    throw 'The sprite pipeline environment is missing. Run npm run sprite-pipeline:setup first.'
}

if (-not (Test-Path -LiteralPath $pipelineCli -PathType Leaf)) {
    throw "The sprite pipeline CLI was not found: $pipelineCli"
}

$env:SPRITE_PIPELINE_INSTALL_ROOT = $pipelineRoot
if ([string]::IsNullOrWhiteSpace($env:SPRITE_PIPELINE_DATA_DIR)) {
    $env:SPRITE_PIPELINE_DATA_DIR = Join-Path $repositoryRoot 'work\sprite-pipeline'
}
if ([string]::IsNullOrWhiteSpace($env:SPRITE_PIPELINE_EXPORTS_DIR)) {
    $env:SPRITE_PIPELINE_EXPORTS_DIR = Join-Path $repositoryRoot 'outputs\sprite-pipeline'
}

$command = if ($Mode -eq 'api') { 'serve-api' } else { 'serve-ui' }
& $pipelinePython $pipelineCli $command
if ($LASTEXITCODE -ne 0) {
    throw "Sprite pipeline $command exited with code $LASTEXITCODE"
}
