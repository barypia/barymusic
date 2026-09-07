[CmdletBinding()]
param(
    [string]$NodeVersion = '22.23.2',
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repoRoot 'dist'
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

$package = Get-Content (Join-Path $repoRoot 'server\package.json') -Raw | ConvertFrom-Json
$releaseName = "BaryMusic-$($package.version)-windows-x64"
$stageRoot = Join-Path $OutputDirectory $releaseName
$zipPath = Join-Path $OutputDirectory "$releaseName.zip"
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("barymusic-build-" + [guid]::NewGuid().ToString('N'))
$nodeArchiveName = "node-v$NodeVersion-win-x64.zip"
$nodeArchivePath = Join-Path $temporaryRoot $nodeArchiveName
$nodeBaseUrl = "https://nodejs.org/dist/v$NodeVersion"

function Copy-DirectoryWithoutNodeModules {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Get-ChildItem -LiteralPath $Source -Force |
        Where-Object { $_.Name -ne 'node_modules' } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force }
}

try {
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    if (Test-Path -LiteralPath $stageRoot) {
        Remove-Item -LiteralPath $stageRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    Write-Host "Downloading Node.js v$NodeVersion..."
    Invoke-WebRequest -UseBasicParsing -Uri "$nodeBaseUrl/$nodeArchiveName" -OutFile $nodeArchivePath
    $checksums = (Invoke-WebRequest -UseBasicParsing -Uri "$nodeBaseUrl/SHASUMS256.txt").Content
    $checksumLine = ($checksums -split "`n") |
        Where-Object { $_.Trim().EndsWith("  $nodeArchiveName") } |
        Select-Object -First 1
    if (-not $checksumLine) {
        throw "The Node.js checksum list does not contain $nodeArchiveName."
    }
    $expectedHash = ($checksumLine.Trim() -split '\s+')[0].ToLowerInvariant()
    $actualHash = (Get-FileHash -LiteralPath $nodeArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "Node.js archive checksum mismatch. Expected $expectedHash, got $actualHash."
    }

    $unpackedRoot = Join-Path $temporaryRoot 'node'
    Expand-Archive -LiteralPath $nodeArchivePath -DestinationPath $unpackedRoot
    $unpackedNode = Get-ChildItem -LiteralPath $unpackedRoot -Directory | Select-Object -First 1
    if (-not $unpackedNode) {
        throw 'The downloaded Node.js archive has an unexpected layout.'
    }

    $runtimeDir = Join-Path $stageRoot 'runtime'
    $appDir = Join-Path $stageRoot 'app'
    $serverDir = Join-Path $appDir 'server'
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    New-Item -ItemType Directory -Path $serverDir -Force | Out-Null
    Copy-Item -Path (Join-Path $unpackedNode.FullName '*') -Destination $runtimeDir -Recurse -Force

    Copy-Item -LiteralPath (Join-Path $repoRoot 'server\barymusic.js') -Destination $serverDir
    Copy-Item -LiteralPath (Join-Path $repoRoot 'server\package.json') -Destination $serverDir
    Copy-Item -LiteralPath (Join-Path $repoRoot 'server\package-lock.json') -Destination $serverDir
    Copy-DirectoryWithoutNodeModules -Source (Join-Path $repoRoot 'frontend') -Destination (Join-Path $appDir 'frontend')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'packaging\windows\launcher.js') -Destination $appDir
    Copy-Item -LiteralPath (Join-Path $repoRoot 'packaging\windows\Start BaryMusic.bat') -Destination $stageRoot
    Copy-Item -LiteralPath (Join-Path $repoRoot 'packaging\windows\Change Settings.bat') -Destination $stageRoot
    Copy-Item -LiteralPath (Join-Path $repoRoot 'README.md') -Destination $stageRoot
    Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination $stageRoot

    Write-Host 'Installing production dependencies for the bundled runtime...'
    Push-Location $serverDir
    try {
        & (Join-Path $runtimeDir 'npm.cmd') ci --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }

        & (Join-Path $runtimeDir 'node.exe') -e "require('bcrypt'); require('sharp'); require('sqlite3')"
        if ($LASTEXITCODE -ne 0) { throw 'Native dependency smoke test failed.' }
    } finally {
        Pop-Location
    }

    # Package managers are only needed while building. Excluding them from the
    # portable runtime reduces its size and removes their dependency tree from
    # the shipped attack surface.
    $runtimeTools = @(
        (Join-Path $runtimeDir 'node_modules\npm'),
        (Join-Path $runtimeDir 'node_modules\corepack'),
        (Join-Path $runtimeDir 'npm'),
        (Join-Path $runtimeDir 'npm.cmd'),
        (Join-Path $runtimeDir 'npx'),
        (Join-Path $runtimeDir 'npx.cmd'),
        (Join-Path $runtimeDir 'corepack'),
        (Join-Path $runtimeDir 'corepack.cmd')
    )
    foreach ($runtimeTool in $runtimeTools) {
        if (Test-Path -LiteralPath $runtimeTool) {
            Remove-Item -LiteralPath $runtimeTool -Recurse -Force
        }
    }

    Write-Host 'Creating portable ZIP...'
    Compress-Archive -LiteralPath $stageRoot -DestinationPath $zipPath -CompressionLevel Optimal
    $releaseHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$zipPath.sha256" -Value "$releaseHash  $([System.IO.Path]::GetFileName($zipPath))" -Encoding Ascii

    Remove-Item -LiteralPath $stageRoot -Recurse -Force
    Write-Host "Created: $zipPath"
    Write-Host "SHA-256: $releaseHash"
} finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}
