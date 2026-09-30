# Restore a backup into the running stack.
# Usage: infra/scripts/restore.ps1 DB_FILE [DATA_FILE]
# The file names are names inside BACKUP_DIR, for example:
#   infra/scripts/restore.ps1 db-20260930-030000.dump data-20260930-030000.tar.gz
#
# WARNING: This replaces the current database and data files.

param(
  [Parameter(Mandatory = $true, Position = 0)][string]$DbFile,
  [Parameter(Position = 1)][string]$DataFile
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '../..')

function Invoke-Compose {
  docker compose @args
  if ($LASTEXITCODE -ne 0) { throw "The command failed: docker compose $args" }
}

Invoke-Compose up -d --wait postgres
Invoke-Compose stop api
$restoreArguments = @($DbFile)
if ($DataFile) { $restoreArguments += $DataFile }
Invoke-Compose run --rm --no-deps backup restore @restoreArguments
Invoke-Compose up -d
