# Creates a Start Menu shortcut that launches FoxBox.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $root 'start-foxbox.cmd'
$programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$shortcutPath = Join-Path $programs 'FoxBox.lnk'
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'

if (-not (Test-Path $launcher)) {
  throw "Launcher not found: $launcher"
}

New-Item -ItemType Directory -Force -Path $programs | Out-Null
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 1
$shortcut.Description = 'Launch FoxBox'
if (Test-Path $electron) {
  $shortcut.IconLocation = "$electron,0"
}
$shortcut.Save()
Write-Host "Start Menu shortcut created:"
Write-Host "  $shortcutPath"
Write-Host "Search Start for FoxBox, or run start-foxbox.cmd in this folder."
