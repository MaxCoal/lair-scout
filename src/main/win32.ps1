param(
  [Parameter(Mandatory = $false)]
  [string]$Title = "",
  [Parameter(Mandatory = $false)]
  [string]$Profile = "",
  [Parameter(Mandatory = $false)]
  [Int64]$Handle = 0,
  [Parameter(Mandatory = $false)]
  [int]$X = 0,
  [Parameter(Mandatory = $false)]
  [int]$Y = 0,
  [Parameter(Mandatory = $false)]
  [int]$Width = 1280,
  [Parameter(Mandatory = $false)]
  [int]$Height = 720,
  [Parameter(Mandatory = $false)]
  [ValidateSet('find', 'hide', 'show', 'place')]
  [string]$Action = 'find'
)

if (-not ('LairScoutNative' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public static class LairScoutNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  public static long[] FindByPids(uint[] pids) {
    List<long> found = new List<long>();
    HashSet<uint> set = new HashSet<uint>(pids);
    EnumWindows((hWnd, lParam) => {
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      if (!set.Contains(pid)) return true;
      if (GetWindow(hWnd, 4) != IntPtr.Zero) return true;
      found.Add(hWnd.ToInt64());
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }
  public static long FindByTitle(string contains) {
    long found = 0;
    EnumWindows((hWnd, lParam) => {
      if (found != 0) return true;
      StringBuilder sb = new StringBuilder(512);
      GetWindowText(hWnd, sb, 512);
      string title = sb.ToString();
      if (!string.IsNullOrEmpty(title) && title.IndexOf(contains, StringComparison.OrdinalIgnoreCase) >= 0) {
        found = hWnd.ToInt64();
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
}

function Get-ProfilePids([string]$ProfileDir) {
  $norm = $ProfileDir.Replace('/', '\').TrimEnd('\')
  $pids = New-Object System.Collections.Generic.List[uint]
  Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(chrome|chromium|firefox)\.exe$' } | ForEach-Object {
    $cmd = $_.CommandLine
    if (-not $cmd) { return }
    $idx = $cmd.IndexOf($norm, [System.StringComparison]::OrdinalIgnoreCase)
    if ($idx -lt 0) { return }
    $end = $idx + $norm.Length
    if ($end -lt $cmd.Length) {
      $next = $cmd[$end]
      if ($next -match '[0-9A-Za-z]') { return }
    }
    [void]$pids.Add([uint]$_.ProcessId)
  }
  return $pids
}

$hwnds = @()
if ($Handle -ne 0) {
  $hwnds = @($Handle)
} elseif ($Profile -ne "") {
  $pids = @(Get-ProfilePids $Profile)
  if ($pids.Count -gt 0) {
    $hwnds = @([LairScoutNative]::FindByPids($pids))
  }
} elseif ($Title -ne "") {
  $found = [LairScoutNative]::FindByTitle($Title)
  if ($found -ne 0) { $hwnds = @($found) }
}

$kept = 0
$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$SWP_SHOWWINDOW = 0x0040
$HWND_TOP = [IntPtr]::Zero

foreach ($raw in $hwnds) {
  $hwnd = [IntPtr]$raw
  if ($hwnd -eq [IntPtr]::Zero) { continue }
  if (-not [LairScoutNative]::IsWindow($hwnd)) { continue }
  if ($Action -eq "hide") {
    # Keep the window shown off-screen so Playwright can still click it.
    [void][LairScoutNative]::ShowWindow($hwnd, 8)
    [void][LairScoutNative]::SetWindowPos($hwnd, [IntPtr]::Zero, -32000, -32000, 1280, 720, ($SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_SHOWWINDOW))
  } elseif ($Action -eq "show") {
    [void][LairScoutNative]::SetWindowPos($hwnd, $HWND_TOP, 80, 80, 1280, 720, $SWP_SHOWWINDOW)
    [void][LairScoutNative]::ShowWindow($hwnd, 9)
    [void][LairScoutNative]::SetForegroundWindow($hwnd)
  } elseif ($Action -eq "place") {
    [void][LairScoutNative]::SetWindowPos($hwnd, $HWND_TOP, $X, $Y, $Width, $Height, $SWP_SHOWWINDOW)
    [void][LairScoutNative]::ShowWindow($hwnd, 9)
    [void][LairScoutNative]::SetForegroundWindow($hwnd)
  }
  if ($kept -eq 0) { $kept = $hwnd.ToInt64() }
}

Write-Output $kept
