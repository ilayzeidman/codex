# Start a long-running dev server (Vite / Next / CRA / generic `npm run dev`)
# and return JSON {pid, url, log, status} on stdout.


[CmdletBinding()]
param(
    [string]$Cwd = (Get-Location).Path,
    [string]$Cmd = "npm run dev",
    [string]$ReadyPattern = "(Local|ready on|started server on|listening on)[:\s]+(https?://[^\s/]+(?::\d+)?(?:/\S*)?)",
    [int]$TimeoutSec = 30,
    [string]$LogDir = $env:TEMP,
    [switch]$Stop
)

$ErrorActionPreference = "Stop"

function Resolve-WindowsExe {
    param([string]$Name)
    if ($IsWindows -or $PSVersionTable.PSEdition -eq "Desktop") {
        if ($Name -match '^(npm|npx|pnpm|yarn)$') { return "$Name.cmd" }
    }
    return $Name
}

function Get-PidFile { param([string]$Path) Join-Path $Path ".codex-devserver.pid" }

function Read-PidFile {
    param([string]$Path)
    $pidFile = Get-PidFile $Path
    if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
    try {
        $obj = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
        if ($obj.pid -and (Get-Process -Id $obj.pid -ErrorAction SilentlyContinue)) { return $obj }
    } catch { }
    return $null
}

# `npm.cmd run dev` spawns a cmd.exe wrapper, which spawns node.exe (Vite).
# Stop-Process only kills the wrapper; node keeps running and the port stays
# bound. Use taskkill /T to walk the descendant tree.
function Stop-ProcessTree {
    param([int]$ProcessId)
    & taskkill.exe /T /F /PID $ProcessId 2>&1 | Out-Null
}

# --- Stop mode ---------------------------------------------------------------
if ($Stop) {
    $existing = Read-PidFile $Cwd
    if ($null -eq $existing) {
        Write-Output (@{ status = "no-server" } | ConvertTo-Json -Compress)
        exit 0
    }
    Stop-ProcessTree -ProcessId $existing.pid
    Remove-Item -LiteralPath (Get-PidFile $Cwd) -ErrorAction SilentlyContinue
    Write-Output (@{ status = "stopped"; pid = $existing.pid } | ConvertTo-Json -Compress)
    exit 0
}

# --- Idempotency: return existing server if still alive ----------------------
$existing = Read-PidFile $Cwd
if ($null -ne $existing) {
    try {
        Invoke-WebRequest -Uri $existing.url -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop | Out-Null
        Write-Output (@{
            status = "already-running"
            pid    = $existing.pid
            url    = $existing.url
            log    = $existing.log
        } | ConvertTo-Json -Compress)
        exit 0
    } catch {
        Remove-Item -LiteralPath (Get-PidFile $Cwd) -ErrorAction SilentlyContinue
    }
}

# --- Spawn -------------------------------------------------------------------
$parts = $Cmd -split '\s+', 2
$exe   = Resolve-WindowsExe $parts[0]
$rest  = if ($parts.Count -gt 1) { $parts[1] } else { "" }
$cwdHash = ($Cwd | ForEach-Object { [System.BitConverter]::ToString(
    (New-Object System.Security.Cryptography.SHA1Managed).ComputeHash(
        [Text.Encoding]::UTF8.GetBytes($_))).Replace("-","").Substring(0,8) })
$logBase = Join-Path $LogDir "codex-devserver-$cwdHash"
$outLog  = "$logBase.out.log"
$errLog  = "$logBase.err.log"
Remove-Item -LiteralPath $outLog, $errLog -ErrorAction SilentlyContinue

$argList = if ([string]::IsNullOrWhiteSpace($rest)) { @() } else { $rest -split '\s+' }
$proc = Start-Process -FilePath $exe `
    -ArgumentList $argList `
    -WorkingDirectory $Cwd `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -WindowStyle Hidden `
    -PassThru

# --- Poll for ready ----------------------------------------------------------
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$url = $null
while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) {
        $errTail = if (Test-Path -LiteralPath $errLog) { (Get-Content -LiteralPath $errLog -Tail 50) -join "`n" } else { "" }
        $outTail = if (Test-Path -LiteralPath $outLog) { (Get-Content -LiteralPath $outLog -Tail 50) -join "`n" } else { "" }
        Write-Error "Dev server exited prematurely (PID $($proc.Id), exit $($proc.ExitCode)).`n--- stderr tail ---`n$errTail`n--- stdout tail ---`n$outTail"
        exit 1
    }
    if (Test-Path -LiteralPath $outLog) {
        $content = Get-Content -LiteralPath $outLog -Raw -ErrorAction SilentlyContinue
        if ($content) {
            # ANSI escape codes from chalk break the regex. Strip both ESC-prefixed
            # CSI sequences (when the console preserved \x1b) and bare `[..m` codes
            # (when stdout redirection ate the ESC byte but left the rendition bytes).
            $stripped = $content -replace "\x1b\[[0-9;]*[a-zA-Z]", ""
            $stripped = $stripped -replace "\[\d+(?:;\d+)*m", ""
            $m = [regex]::Match($stripped, $ReadyPattern)
            if ($m.Success) {
                $url = $m.Groups[2].Value.TrimEnd('/', ',', '.', ';')
                break
            }
        }
    }
    Start-Sleep -Milliseconds 250
}

if (-not $url) {
    $errTail = if (Test-Path -LiteralPath $errLog) { (Get-Content -LiteralPath $errLog -Tail 50) -join "`n" } else { "" }
    $outTail = if (Test-Path -LiteralPath $outLog) { (Get-Content -LiteralPath $outLog -Tail 50) -join "`n" } else { "" }
    Stop-ProcessTree -ProcessId $proc.Id
    Write-Error "Timed out after ${TimeoutSec}s waiting for a ready line matching '$ReadyPattern'.`n--- stdout tail ---`n$outTail`n--- stderr tail ---`n$errTail"
    exit 1
}

# --- Liveness check ----------------------------------------------------------
try {
    Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop | Out-Null
} catch {
    Write-Error "Found ready line url=$url but Invoke-WebRequest failed: $($_.Exception.Message)"
    Stop-ProcessTree -ProcessId $proc.Id
    exit 1
}

# --- Write PID sidecar + emit JSON ------------------------------------------
$record = [ordered]@{
    pid    = $proc.Id
    url    = $url
    log    = $outLog
    errLog = $errLog
    cwd    = $Cwd
    cmd    = $Cmd
    status = "started"
}
$record | ConvertTo-Json -Compress | Set-Content -LiteralPath (Get-PidFile $Cwd) -Encoding UTF8
Write-Output ($record | ConvertTo-Json -Compress)
exit 0
