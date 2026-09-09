$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
try {
    $nodePath = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    $dshRoot = Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh'
    $dshEntry = Join-Path $dshRoot 'lib\bin.js'
    if (!(Test-Path -LiteralPath $nodePath) -or !(Test-Path -LiteralPath $dshEntry)) { throw '未找到本机标准位置的 Node.js 或 DSH。请先安装这两个程序。' }
    $version = (Get-Content -LiteralPath (Join-Path $dshRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
    if ($version -ne '0.1.2-rc.1') { throw "本插件适用于 DSH 0.1.2-rc.1，当前为 $version。未修改配置。" }
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title = '选择下载的 Qwen 上下文压缩插件安装包'
    $picker.Filter = 'Qwen 压缩插件|dsh-qwen38-compaction-*.tgz'
    if ($picker.ShowDialog() -ne 'OK') { return }
    $packagePath = $picker.FileName
    $picker.Dispose()
    $dshHomePath = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
    $profilePath = Join-Path $dshHomePath 'profiles\web'
    $backupPath = Join-Path $env:USERPROFILE ('BackUp\DSH上下文压缩插件_'+(Get-Date -Format 'yyyyMMdd_HHmmss'))
    New-Item -ItemType Directory -Path $backupPath | Out-Null
    if (Test-Path -LiteralPath $profilePath) {
        Get-ChildItem -LiteralPath $profilePath -File | ForEach-Object {
            $copyPath = Join-Path $backupPath $_.Name
            Copy-Item -LiteralPath $_.FullName -Destination $copyPath
            if ((Get-FileHash -LiteralPath $_.FullName).Hash -ne (Get-FileHash -LiteralPath $copyPath).Hash) { throw '备份校验失败，停止安装。' }
        }
    }
    & $nodePath $dshEntry plugin --profile web add $packagePath --trust-lockfile --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw "安装失败。原配置备份保留在：$backupPath" }
    [System.Windows.Forms.MessageBox]::Show("安装完成。请等当前任务结束后重启 DSH，再打开原标准模式对话。`n配置备份：$backupPath", 'Qwen 压缩插件') | Out-Null
} catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '未完成安装') | Out-Null
    exit 1
}
