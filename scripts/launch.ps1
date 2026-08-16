<#
    奥马哈 · 鱿鱼局 —— 一键启动器

    做三件事：
      1. 找到 Node（不需要它在 PATH 里）
      2. 第一次运行时自动 npm install
      3. 启动 vite 开发服务器并打开浏览器

    直接双击仓库根目录的「启动游戏.cmd」即可，或者用 scripts\create-shortcut.ps1
    在桌面生成快捷方式。
#>
[CmdletBinding()]
param(
    # 仓库根目录。桌面快捷方式会显式传进来；从仓库里直接运行时自动推断。
    [string] $RepoPath,
    [int]    $Port = 5173,
    # 只起服务器，不自动开浏览器（调试用）
    [switch] $NoOpen
)

$ErrorActionPreference = 'Stop'

# 直接跑这个脚本（没经过 launch.cmd 的 chcp）时，中文也要能正常显示
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { $Host.UI.RawUI.WindowTitle = '奥马哈 · 鱿鱼局（关掉这个窗口就结束游戏）' } catch {}

function Write-Step  ([string]$Message) { Write-Host "  $Message" -ForegroundColor Cyan }
function Write-Fail  ([string]$Message) { Write-Host "  $Message" -ForegroundColor Red }

function Wait-BeforeExit ([int]$Code) {
    Write-Host ''
    Write-Host '  按回车键关闭这个窗口。' -ForegroundColor DarkGray
    try { [void](Read-Host) } catch {}
    exit $Code
}

# 找 node.exe：先看 PATH，再看常见安装位置。
function Find-NodeExe {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $roots = @(
        $env:ProgramFiles,
        ${env:ProgramFiles(x86)},
        $env:LOCALAPPDATA
    ) | Where-Object { $_ }

    $candidates = @()
    foreach ($root in $roots) {
        $candidates += (Join-Path $root 'nodejs\node.exe')
        $candidates += (Join-Path $root 'Programs\nodejs\node.exe')
    }
    # nvm-windows
    if ($env:NVM_SYMLINK) { $candidates += (Join-Path $env:NVM_SYMLINK 'node.exe') }

    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c) { return $c }
    }
    return $null
}

# 端口上已经有人应答？说明游戏已经在跑了。
# vite 默认只监听 IPv6 的 [::1]，所以两个回环地址都要试，光试 127.0.0.1 会漏。
function Test-PortInUse ([int]$TcpPort) {
    $addresses = @([System.Net.IPAddress]::IPv6Loopback, [System.Net.IPAddress]::Loopback)
    foreach ($address in $addresses) {
        $client = New-Object System.Net.Sockets.TcpClient($address.AddressFamily)
        try {
            $client.Connect($address, $TcpPort)
            if ($client.Connected) { return $true }
        } catch {
            # 连不上就是没人监听，换下一个地址
        } finally {
            $client.Close()
        }
    }
    return $false
}

Write-Host ''
Write-Host '  🦑  奥马哈 · 鱿鱼局' -ForegroundColor Green
Write-Host ''

# ---- 仓库位置 ----------------------------------------------------------------
if (-not $RepoPath) { $RepoPath = Split-Path -Parent $PSScriptRoot }
if (-not (Test-Path -LiteralPath (Join-Path $RepoPath 'package.json'))) {
    Write-Fail "找不到游戏文件：$RepoPath"
    Write-Fail '如果仓库被移动过，重新跑一次 scripts\create-shortcut.ps1 生成新的快捷方式。'
    Wait-BeforeExit 1
}
$RepoPath = (Resolve-Path -LiteralPath $RepoPath).Path

# ---- 已经在运行就直接开浏览器 ------------------------------------------------
if (Test-PortInUse $Port) {
    Write-Step "游戏已经在运行，直接打开浏览器 http://localhost:$Port/"
    if (-not $NoOpen) { Start-Process "http://localhost:$Port/" }
    Start-Sleep -Seconds 1
    exit 0
}

# ---- Node ---------------------------------------------------------------------
$node = Find-NodeExe
if (-not $node) {
    Write-Fail '没找到 Node.js。'
    Write-Fail '请先到 https://nodejs.org 装一个 LTS 版本（一路下一步即可），然后再点这个快捷方式。'
    Wait-BeforeExit 1
}
$nodeDir = Split-Path -Parent $node
if (($env:Path -split ';') -notcontains $nodeDir) { $env:Path = "$nodeDir;$env:Path" }

# ---- 依赖 ---------------------------------------------------------------------
Set-Location -LiteralPath $RepoPath
$viteBin = Join-Path $RepoPath 'node_modules\vite\bin\vite.js'

if (-not (Test-Path -LiteralPath $viteBin)) {
    $npm = Join-Path $nodeDir 'npm.cmd'
    if (-not (Test-Path -LiteralPath $npm)) {
        Write-Fail "找到了 Node 但没找到 npm（$npm）。请重装 Node.js。"
        Wait-BeforeExit 1
    }
    Write-Step '第一次启动，正在下载依赖，大概 1~3 分钟，只有这一次需要等……'
    Write-Host ''
    & $npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Fail '依赖安装失败了，多半是网络问题。连上网之后再点一次快捷方式即可。'
        Wait-BeforeExit $LASTEXITCODE
    }
    Write-Host ''
    Write-Step '依赖装好了。'
}

# ---- 开打 ---------------------------------------------------------------------
if ($NoOpen) {
    Write-Step "正在启动 http://localhost:$Port/"
} else {
    Write-Step "正在启动，浏览器会自动打开 http://localhost:$Port/"
}
Write-Host '  想结束游戏，关掉这个黑窗口就行。' -ForegroundColor DarkGray
Write-Host ''

$viteArgs = @('--port', $Port)
if (-not $NoOpen) { $viteArgs += '--open' }

if (Test-Path -LiteralPath $viteBin) {
    & $node $viteBin @viteArgs
} else {
    # vite 的入口万一挪了位置，退回到 package.json 里的 npm script
    & (Join-Path $nodeDir 'npm.cmd') run dev -- @viteArgs
}

if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Fail "游戏服务器退出了（代码 $LASTEXITCODE）。上面的红字是原因。"
    Wait-BeforeExit $LASTEXITCODE
}
