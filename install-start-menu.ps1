# Creates a Start Menu shortcut that launches Lair Scout.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $root 'start-lair-scout.cmd'
$programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$shortcutPath = Join-Path $programs 'Lair Scout.lnk'
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
$shortcut.Description = 'Launch Lair Scout'
if (Test-Path $electron) {
  $shortcut.IconLocation = "$electron,0"
}
$shortcut.Save()
Write-Host "Start Menu shortcut created:"
Write-Host "  $shortcutPath"
Write-Host "Search Start for Lair Scout, or run start-lair-scout.cmd in this folder."
