<#
    在桌面（和开始菜单）生成「奥马哈 · 鱿鱼局」快捷方式。

    用法：右键这个文件 →「使用 PowerShell 运行」，或者：
        powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1

    启动器会被安装到 %LOCALAPPDATA%\OmahaSquid\，这样快捷方式不依赖当前分支、
    也不会在仓库里留下未跟踪的文件。仓库换位置之后重新跑一次即可。
#>
[CmdletBinding()]
param(
    [string] $RepoPath,
    [string] $ShortcutName = '奥马哈鱿鱼局',
    [switch] $NoStartMenu
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

Add-Type -AssemblyName PresentationCore, PresentationFramework, WindowsBase

# --- 图标：绿呢台面上一张扑克牌，牌面是鱿鱼 --------------------------------------
$script:Felt     = '#1B3A2F'   # 台面亮部
$script:FeltDark = '#0B1B18'   # 台面暗部
$script:CardFace = '#F7F5EF'   # 牌面米白
$script:Ink      = '#14342A'   # 牌面上的深绿（鱿鱼、黑桃）
$script:Heart    = '#D8352A'   # 红心

function New-Brush ([string]$Hex) {
    New-Object System.Windows.Media.SolidColorBrush(
        [System.Windows.Media.ColorConverter]::ConvertFromString($Hex))
}

function Draw-CenteredGlyph ($Dc, [string]$Text, [string]$Font, [double]$EmSize, $Brush,
                             [double]$CenterX, [double]$CenterY) {
    $formatted = New-Object System.Windows.Media.FormattedText(
        $Text,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Windows.FlowDirection]::LeftToRight,
        (New-Object System.Windows.Media.Typeface($Font)),
        $EmSize,
        $Brush)
    $Dc.DrawText($formatted, (New-Object System.Windows.Point(
        ($CenterX - $formatted.Width / 2), ($CenterY - $formatted.Height / 2))))
}

function New-IconBitmap ([int]$Size) {
    $visual = New-Object System.Windows.Media.DrawingVisual
    $dc = $visual.RenderOpen()

    # 台面
    $felt = New-Object System.Windows.Media.LinearGradientBrush
    $felt.StartPoint = New-Object System.Windows.Point(0, 0)
    $felt.EndPoint   = New-Object System.Windows.Point(1, 1)
    $felt.GradientStops.Add((New-Object System.Windows.Media.GradientStop(
        [System.Windows.Media.ColorConverter]::ConvertFromString($script:Felt), 0.0)))
    $felt.GradientStops.Add((New-Object System.Windows.Media.GradientStop(
        [System.Windows.Media.ColorConverter]::ConvertFromString($script:FeltDark), 1.0)))
    $dc.DrawRoundedRectangle($felt, $null,
        (New-Object System.Windows.Rect(0, 0, $Size, $Size)), $Size * 0.22, $Size * 0.22)

    # 微微倾斜的一张牌
    $center = $Size * 0.5
    $dc.PushTransform((New-Object System.Windows.Media.RotateTransform(-8, $center, $center)))
    $cardWidth  = $Size * 0.60
    $cardHeight = $Size * 0.80
    $card = New-Object System.Windows.Rect(
        ($center - $cardWidth / 2), ($center - $cardHeight / 2), $cardWidth, $cardHeight)
    $edge = New-Object System.Windows.Media.Pen((New-Brush $script:FeltDark), ($Size * 0.02))
    $dc.DrawRoundedRectangle((New-Brush $script:CardFace), $edge, $card, $Size * 0.06, $Size * 0.06)

    # 角标：16/24 像素下画上去只会糊成一团，所以只在 32 以上加
    if ($Size -ge 32) {
        Draw-CenteredGlyph $dc ([char]0x2660) 'Segoe UI Symbol' ($Size * 0.19) (New-Brush $script:Ink) `
            ($Size * 0.30) ($Size * 0.235)
        Draw-CenteredGlyph $dc ([char]0x2665) 'Segoe UI Symbol' ($Size * 0.19) (New-Brush $script:Heart) `
            ($Size * 0.70) ($Size * 0.765)
    }

    # 牌面主体：鱿鱼
    Draw-CenteredGlyph $dc ([System.Char]::ConvertFromUtf32(0x1F991)) 'Segoe UI Emoji' `
        ($Size * 0.38) (New-Brush $script:Ink) $center $center

    $dc.Pop()
    $dc.Close()

    $bitmap = New-Object System.Windows.Media.Imaging.RenderTargetBitmap(
        $Size, $Size, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($visual)
    return $bitmap
}

function ConvertTo-PngBytes ([System.Windows.Media.Imaging.BitmapSource]$Bitmap) {
    $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($Bitmap))
    $stream = New-Object System.IO.MemoryStream
    $encoder.Save($stream)
    return ,$stream.ToArray()   # 逗号：别让 PowerShell 把 byte[] 拆成一个个元素
}

# 32 位 BGRA 的 DIB（BITMAPINFOHEADER + 像素 + 全零 AND 掩码），兼容性最好的 ICO 帧格式
function ConvertTo-DibBytes ([System.Windows.Media.Imaging.BitmapSource]$Bitmap) {
    $w = $Bitmap.PixelWidth
    $h = $Bitmap.PixelHeight
    $straight = New-Object System.Windows.Media.Imaging.FormatConvertedBitmap(
        $Bitmap, [System.Windows.Media.PixelFormats]::Bgra32, $null, 0)

    $stride = $w * 4
    $pixels = New-Object 'byte[]' ($stride * $h)
    $straight.CopyPixels($pixels, $stride, 0)

    $maskStride = [int][Math]::Floor(($w + 31) / 32) * 4
    $stream = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter($stream)
    $writer.Write([uint32]40)                                  # biSize
    $writer.Write([int32]$w)                                   # biWidth
    $writer.Write([int32]($h * 2))                             # biHeight（图像 + 掩码）
    $writer.Write([uint16]1)                                   # biPlanes
    $writer.Write([uint16]32)                                  # biBitCount
    $writer.Write([uint32]0)                                   # biCompression = BI_RGB
    $writer.Write([uint32]($stride * $h + $maskStride * $h))   # biSizeImage
    $writer.Write([int32]0); $writer.Write([int32]0)           # 分辨率
    $writer.Write([uint32]0); $writer.Write([uint32]0)         # 调色板
    for ($y = $h - 1; $y -ge 0; $y--) { $writer.Write($pixels, $y * $stride, $stride) }
    $writer.Write((New-Object 'byte[]' ($maskStride * $h)))
    $writer.Flush()
    return ,$stream.ToArray()
}

function Save-IcoFile ([string]$Path) {
    $frames = @()
    foreach ($size in 16, 24, 32, 48, 64, 128) {
        $frames += @{ Size = $size; Data = [byte[]](ConvertTo-DibBytes (New-IconBitmap $size)) }
    }
    # 256 用 PNG 压缩，这是 Vista 以后的惯例，可以少几十 KB
    $frames += @{ Size = 256; Data = [byte[]](ConvertTo-PngBytes (New-IconBitmap 256)) }

    $stream = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter($stream)
    $writer.Write([uint16]0)                # 保留
    $writer.Write([uint16]1)                # 类型：图标
    $writer.Write([uint16]$frames.Count)

    $offset = 6 + 16 * $frames.Count
    foreach ($frame in $frames) {
        $dim = if ($frame.Size -ge 256) { 0 } else { $frame.Size }   # 256 记作 0
        $writer.Write([byte]$dim)
        $writer.Write([byte]$dim)
        $writer.Write([byte]0)              # 调色板颜色数
        $writer.Write([byte]0)              # 保留
        $writer.Write([uint16]1)            # 平面数
        $writer.Write([uint16]32)           # 位深
        $writer.Write([uint32]$frame.Data.Length)
        $writer.Write([uint32]$offset)
        $offset += $frame.Data.Length
    }
    foreach ($frame in $frames) { $writer.Write($frame.Data) }
    $writer.Flush()
    [System.IO.File]::WriteAllBytes($Path, $stream.ToArray())
}

# --- 安装 -----------------------------------------------------------------------
if (-not $RepoPath) { $RepoPath = Split-Path -Parent $PSScriptRoot }
if (-not (Test-Path -LiteralPath (Join-Path $RepoPath 'package.json'))) {
    throw "在 $RepoPath 里没找到 package.json，用 -RepoPath 指定仓库根目录。"
}
$RepoPath = (Resolve-Path -LiteralPath $RepoPath).Path

$installDir = Join-Path $env:LOCALAPPDATA 'OmahaSquid'
if (-not (Test-Path -LiteralPath $installDir)) {
    New-Item -ItemType Directory -Path $installDir | Out-Null
}

Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'launch.ps1') -Destination $installDir -Force

$cmdPath = Join-Path $installDir 'launch.cmd'
# 用绝对路径调 chcp / powershell，PATH 被人搞坏过也照样能启动
$cmdText = @"
@echo off
"%SystemRoot%\System32\chcp.com" 65001 >nul
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" -RepoPath "$RepoPath" %*
"@
[System.IO.File]::WriteAllText($cmdPath, ($cmdText -replace "`r?`n", "`r`n"),
    (New-Object System.Text.UTF8Encoding($false)))

$icoPath = Join-Path $installDir 'omaha-squid.ico'
Save-IcoFile $icoPath

$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$targets = @((Join-Path $desktop "$ShortcutName.lnk"))
if (-not $NoStartMenu) {
    $startMenu = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Windows\Start Menu\Programs'
    $targets += (Join-Path $startMenu "$ShortcutName.lnk")
}

foreach ($lnkPath in $targets) {
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath       = $cmdPath
    $lnk.WorkingDirectory = $RepoPath
    $lnk.IconLocation     = "$icoPath,0"
    $lnk.Description      = '奥马哈 · 鱿鱼局 —— 本地 PLO4 对战'
    $lnk.WindowStyle      = 1
    $lnk.Save()
    Write-Host "  已创建：$lnkPath" -ForegroundColor Green
}

# 图标文件名没变，资源管理器会接着用缓存里的旧图；通知一下让它重新读
try {
    if (-not ('Shell32.Api' -as [type])) {
        Add-Type -Namespace Shell32 -Name Api -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("shell32.dll")]
public static extern void SHChangeNotify(int eventId, uint flags, System.IntPtr item1, System.IntPtr item2);
'@
    }
    [Shell32.Api]::SHChangeNotify(0x08000000, 0, [System.IntPtr]::Zero, [System.IntPtr]::Zero)
} catch {
    Write-Host '  （图标缓存没刷新成功，注销重登或重启资源管理器就会更新）' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host "  游戏目录：$RepoPath" -ForegroundColor DarkGray
Write-Host "  启动器：  $cmdPath" -ForegroundColor DarkGray
Write-Host ''
Write-Host '  双击桌面上的快捷方式就能开打。' -ForegroundColor Cyan
