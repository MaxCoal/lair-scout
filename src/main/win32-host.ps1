Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;

[ComImport]
[Guid("56FDF342-FD6D-11d0-958A-006097C9A090")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IFoxTaskbarList {
  void HrInit();
  void AddTab(IntPtr hwnd);
  void DeleteTab(IntPtr hwnd);
  void ActivateTab(IntPtr hwnd);
  void SetActiveAlt(IntPtr hwnd);
}

[StructLayout(LayoutKind.Sequential)]
public struct FoxRect {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}

public static class FoxBoxNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out FoxRect lpRect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

  static IFoxTaskbarList taskbar;

  static FoxBoxNative() {
    try {
      Type t = Type.GetTypeFromCLSID(new Guid("56FDF344-FD6D-11d0-958A-006097C9A090"));
      taskbar = (IFoxTaskbarList)Activator.CreateInstance(t);
      taskbar.HrInit();
    } catch {}
  }

  public static long FindBestByPids(uint[] pids) {
    long best = 0;
    int bestScore = -1;
    HashSet<uint> set = new HashSet<uint>(pids);
    EnumWindows((hWnd, lParam) => {
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      if (!set.Contains(pid)) return true;
      StringBuilder cls = new StringBuilder(256);
      GetClassName(hWnd, cls, 256);
      string c = cls.ToString();
      if (c == "Chrome_WidgetWin_0" || c == "Intermediate D3D Window") return true;
      FoxRect r;
      GetWindowRect(hWnd, out r);
      int w = r.Right - r.Left;
      int h = r.Bottom - r.Top;
      if (w < 50 || h < 50) return true;
      StringBuilder sb = new StringBuilder(512);
      GetWindowText(hWnd, sb, 512);
      string title = sb.ToString();
      int score = 0;
      if (c.IndexOf("Chrome_WidgetWin_1", StringComparison.OrdinalIgnoreCase) >= 0) score += 120;
      if (c.IndexOf("MozillaWindowClass", StringComparison.OrdinalIgnoreCase) >= 0) score += 120;
      if (title.IndexOf("FoxBox-", StringComparison.OrdinalIgnoreCase) >= 0) score += 40;
      if (w >= 400 && h >= 300) score += 25;
      if (IsWindowVisible(hWnd)) score += 8;
      if (score > bestScore) {
        bestScore = score;
        best = hWnd.ToInt64();
      }
      return true;
    }, IntPtr.Zero);
    return best;
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

  public static void SetOwner(IntPtr hwnd, IntPtr owner) {
    SetWindowLongPtr(hwnd, -8, owner);
  }

  public static void SetTaskbar(IntPtr hwnd, bool show) {
    const int GWL_EXSTYLE = -20;
    const int WS_EX_APPWINDOW = 0x00040000;
    const int WS_EX_TOOLWINDOW = 0x00000080;
    int ex = GetWindowLong(hwnd, GWL_EXSTYLE);
    if (show) {
      ex = (ex | WS_EX_APPWINDOW) & ~WS_EX_TOOLWINDOW;
      try { if (taskbar != null) taskbar.AddTab(hwnd); } catch {}
    } else {
      ex = (ex | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW;
      try { if (taskbar != null) taskbar.DeleteTab(hwnd); } catch {}
    }
    SetWindowLong(hwnd, GWL_EXSTYLE, ex);
    SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0020);
  }
}
"@

$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$SWP_SHOWWINDOW = 0x0040
$HWND_TOPMOST = [IntPtr]::new(-1)
$HWND_NOTOPMOST = [IntPtr]::new(-2)
$HWND_TOP = [IntPtr]::Zero

function Get-RelatedPids([uint32]$root) {
  $pids = New-Object System.Collections.Generic.List[uint32]
  [void]$pids.Add($root)
  try {
    Get-CimInstance Win32_Process | ForEach-Object {
      if ([uint32]$_.ParentProcessId -eq $root) {
        [void]$pids.Add([uint32]$_.ProcessId)
      }
    }
  } catch {}
  return ,$pids.ToArray()
}

function Get-Hwnd($cmd) {
  if ($cmd.handle -and ([Int64]$cmd.handle -ne 0)) {
    $hwnd = [IntPtr]([Int64]$cmd.handle)
    if ([FoxBoxNative]::IsWindow($hwnd)) { return [Int64]$cmd.handle }
  }
  if ($cmd.pid -and ([uint32]$cmd.pid -ne 0)) {
    $found = [FoxBoxNative]::FindBestByPids((Get-RelatedPids ([uint32]$cmd.pid)))
    if ($found -ne 0) { return $found }
  }
  if ($cmd.title) {
    $found = [FoxBoxNative]::FindByTitle([string]$cmd.title)
    if ($found -ne 0) { return $found }
  }
  return 0
}

function Invoke-FoxAction($cmd) {
  $raw = Get-Hwnd $cmd
  if ($raw -eq 0) { return 0 }
  $hwnd = [IntPtr]$raw
  if (-not [FoxBoxNative]::IsWindow($hwnd)) { return 0 }

  $action = [string]$cmd.action
  $x = [int]($cmd.x)
  $y = [int]($cmd.y)
  $w = [int]($cmd.width)
  $h = [int]($cmd.height)
  if ($w -le 0) { $w = 1280 }
  if ($h -le 0) { $h = 720 }

  $owner = 0
  if ($cmd.owner) { $owner = [Int64]$cmd.owner }
  $taskbar = $false
  if ($null -ne $cmd.taskbar) { $taskbar = [bool]$cmd.taskbar }
  $topmost = $false
  if ($null -ne $cmd.topmost) { $topmost = [bool]$cmd.topmost }

    if ($action -eq "find") {
      return $raw
    } elseif ($action -eq "hide") {
    [FoxBoxNative]::SetOwner($hwnd, [IntPtr]$owner)
    [FoxBoxNative]::SetTaskbar($hwnd, $false)
    [void][FoxBoxNative]::ShowWindow($hwnd, 8)
    [void][FoxBoxNative]::SetWindowPos($hwnd, $HWND_NOTOPMOST, -32000, -32000, 1280, 720, ($SWP_NOACTIVATE -bor $SWP_SHOWWINDOW))
  } elseif ($action -eq "show") {
    [FoxBoxNative]::SetOwner($hwnd, [IntPtr]::Zero)
    [FoxBoxNative]::SetTaskbar($hwnd, $true)
    [void][FoxBoxNative]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 80, 80, 1280, 720, $SWP_SHOWWINDOW)
    [void][FoxBoxNative]::ShowWindow($hwnd, 9)
    [void][FoxBoxNative]::SetForegroundWindow($hwnd)
  } elseif ($action -eq "place") {
    [FoxBoxNative]::SetOwner($hwnd, [IntPtr]$owner)
    [FoxBoxNative]::SetTaskbar($hwnd, $taskbar)
    $z = if ($topmost) { $HWND_TOPMOST } else { $HWND_TOP }
    [void][FoxBoxNative]::ShowWindow($hwnd, 9)
    [void][FoxBoxNative]::SetWindowPos($hwnd, $z, $x, $y, $w, $h, $SWP_SHOWWINDOW)
  }

  return $raw
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
