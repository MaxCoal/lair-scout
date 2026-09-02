Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public static class FoxBoxNative {
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

$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$SWP_SHOWWINDOW = 0x0040

function Get-Hwnds($cmd) {
  $hwnds = @()
  if ($cmd.handle -and ([Int64]$cmd.handle -ne 0)) {
    $hwnds += [Int64]$cmd.handle
  }
  if ($cmd.pid -and ([uint32]$cmd.pid -ne 0)) {
    $hwnds += [FoxBoxNative]::FindByPids(@([uint32]$cmd.pid))
  }
  if ($cmd.title) {
    $found = [FoxBoxNative]::FindByTitle([string]$cmd.title)
    if ($found -ne 0) { $hwnds += $found }
  }
  return $hwnds | Select-Object -Unique
}

function Invoke-FoxAction($cmd) {
  $hwnds = @(Get-Hwnds $cmd)
  $kept = 0
  $x = [int]($cmd.x)
  $y = [int]($cmd.y)
  $w = [int]($cmd.width)
  $h = [int]($cmd.height)
  if ($w -le 0) { $w = 1280 }
  if ($h -le 0) { $h = 720 }
  foreach ($raw in $hwnds) {
    $hwnd = [IntPtr]$raw
    if ($hwnd -eq [IntPtr]::Zero) { continue }
    if (-not [FoxBoxNative]::IsWindow($hwnd)) { continue }
    $action = [string]$cmd.action
    if ($action -eq "hide") {
      [void][FoxBoxNative]::ShowWindow($hwnd, 8)
      [void][FoxBoxNative]::SetWindowPos($hwnd, [IntPtr]::Zero, -32000, -32000, 1280, 720, ($SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_SHOWWINDOW))
    } elseif ($action -eq "show") {
      [void][FoxBoxNative]::SetWindowPos($hwnd, [IntPtr]::Zero, 80, 80, 1280, 720, $SWP_SHOWWINDOW)
      [void][FoxBoxNative]::ShowWindow($hwnd, 9)
      [void][FoxBoxNative]::SetForegroundWindow($hwnd)
    } elseif ($action -eq "place") {
      [void][FoxBoxNative]::SetWindowPos($hwnd, [IntPtr]::Zero, $x, $y, $w, $h, $SWP_SHOWWINDOW)
      [void][FoxBoxNative]::ShowWindow($hwnd, 9)
      [void][FoxBoxNative]::SetForegroundWindow($hwnd)
    }
    if ($kept -eq 0) { $kept = $hwnd.ToInt64() }
  }
  return $kept
}

try {
  [Console]::InputEncoding = [System.Text.Encoding]::UTF8
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  try {
    $cmd = $line | ConvertFrom-Json
    $result = Invoke-FoxAction $cmd
    [Console]::Out.WriteLine([string]$result)
  } catch {
    [Console]::Out.WriteLine("0")
  }
  [Console]::Out.Flush()
}
