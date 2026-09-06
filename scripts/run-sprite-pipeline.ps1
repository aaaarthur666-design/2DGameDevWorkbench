[CmdletBinding()]
param(
    [ValidateSet('ui', 'api')]
    [string] $Mode = 'ui'
)
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'run-sprite-pipeline.mjs') $Mode
exit $LASTEXITCODE
