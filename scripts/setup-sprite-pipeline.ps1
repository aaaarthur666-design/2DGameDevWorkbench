[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'setup-sprite-pipeline.mjs')
exit $LASTEXITCODE
