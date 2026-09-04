# Creates Start Menu and Desktop shortcuts for Lair Scout (source checkout).
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcher = Join-Path $repo 'Start.cmd'
$icon = Join-Path $repo 'resources\icon.ico'
$programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$desktop = [Environment]::GetFolderPath('Desktop')

if (-not (Test-Path $launcher)) {
  throw "Launcher not found: $launcher"
}

function Write-Shortcut([string]$path) {
  $folder = Split-Path -Parent $path
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $launcher
  $shortcut.WorkingDirectory = $repo
  $shortcut.WindowStyle = 1
  $shortcut.Description = 'Launch Lair Scout'
  if (Test-Path $icon) {
    $shortcut.IconLocation = $icon
  }
  $shortcut.Save()
  Write-Host "  $path"
}

Write-Host 'Shortcuts created:'
Write-Shortcut (Join-Path $programs 'Lair Scout.lnk')
Write-Shortcut (Join-Path $desktop 'Lair Scout.lnk')
Write-Host 'Search Start for Lair Scout, or run Start.cmd in the repo folder.'
