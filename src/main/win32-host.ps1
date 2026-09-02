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

[StructLayout(LayoutKind.Sequential)]
public struct FoxPoint {
  public int X;
  public int Y;
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
  [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr hWnd, ref FoxPoint lpPoint);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);

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

  public static void MakeDpiAware() {
    try { SetProcessDpiAwareness(2); }
    catch {
      try { SetProcessDPIAware(); } catch {}
    }
  }

  public static void SetOwner(IntPtr hwnd, IntPtr owner) {
    SetWindowLongPtr(hwnd, -8, owner);
  }

  public static void SetEmbedded(IntPtr hwnd, bool embedded) {
    const int GWL_STYLE = -16;
    const int WS_CHILD = 0x40000000;
    const int WS_POPUP = unchecked((int)0x80000000);
    const int WS_CAPTION = 0x00C00000;
    const int WS_THICKFRAME = 0x00040000;
    const int WS_SYSMENU = 0x00080000;
    const int WS_MINIMIZEBOX = 0x00020000;
    const int WS_MAXIMIZEBOX = 0x00010000;
    const int WS_BORDER = 0x00800000;
    const int WS_VISIBLE = 0x10000000;
    int style = GetWindowLong(hwnd, GWL_STYLE);
    if (embedded) {
      style |= WS_CHILD | WS_VISIBLE;
      style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_BORDER);
    } else {
      style &= ~WS_CHILD;
      style |= WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_VISIBLE;
    }
    SetWindowLong(hwnd, GWL_STYLE, style);
  }

  public static void EmbedAt(IntPtr hwnd, IntPtr owner, int screenX, int screenY, int w, int h) {
    if (owner != IntPtr.Zero) SetParent(hwnd, owner);
    SetEmbedded(hwnd, owner != IntPtr.Zero);
    SetTaskbar(hwnd, false);
    int x = screenX;
    int y = screenY;
    if (owner != IntPtr.Zero) {
      FoxPoint p = new FoxPoint();
      p.X = screenX;
      p.Y = screenY;
      ScreenToClient(owner, ref p);
      x = p.X;
      y = p.Y;
    }
    ShowWindow(hwnd, 8);
    SetWindowPos(hwnd, IntPtr.Zero, x, y, w, h, 0x0040 | 0x0020);
  }

  public static void Detach(IntPtr hwnd, IntPtr ownerKeep) {
    SetEmbedded(hwnd, false);
    SetParent(hwnd, IntPtr.Zero);
    if (ownerKeep != IntPtr.Zero) SetOwner(hwnd, ownerKeep);
    else SetOwner(hwnd, IntPtr.Zero);
  }

  public static void SetFrame(IntPtr hwnd, bool chrome) {
    const int GWL_STYLE = -16;
    const int WS_CAPTION = 0x00C00000;
    const int WS_THICKFRAME = 0x00040000;
    const int WS_SYSMENU = 0x00080000;
    const int WS_MINIMIZEBOX = 0x00020000;
    const int WS_MAXIMIZEBOX = 0x00010000;
    const int WS_BORDER = 0x00800000;
    int style = GetWindowLong(hwnd, GWL_STYLE);
    if (chrome) {
      style |= WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
    } else {
      style &= ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_BORDER);
    }
    SetWindowLong(hwnd, GWL_STYLE, style);
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

[void][FoxBoxNative]::MakeDpiAware()

$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$SWP_SHOWWINDOW = 0x0040
$SWP_FRAMECHANGED = 0x0020
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
    [FoxBoxNative]::Detach($hwnd, [IntPtr]$owner)
    [FoxBoxNative]::SetTaskbar($hwnd, $false)
    [FoxBoxNative]::SetFrame($hwnd, $true)
    [void][FoxBoxNative]::ShowWindow($hwnd, 8)
    [void][FoxBoxNative]::SetWindowPos($hwnd, $HWND_NOTOPMOST, -32000, -32000, 1280, 720, ($SWP_NOACTIVATE -bor $SWP_SHOWWINDOW -bor $SWP_FRAMECHANGED))
  } elseif ($action -eq "show") {
    [FoxBoxNative]::Detach($hwnd, [IntPtr]::Zero)
    [FoxBoxNative]::SetFrame($hwnd, $true)
    [FoxBoxNative]::SetTaskbar($hwnd, $true)
    [void][FoxBoxNative]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 80, 80, 1280, 720, ($SWP_SHOWWINDOW -bor $SWP_FRAMECHANGED))
    [void][FoxBoxNative]::ShowWindow($hwnd, 8)
    [void][FoxBoxNative]::SetForegroundWindow($hwnd)
  } elseif ($action -eq "place") {
    if ($cmd.pid -and ([uint32]$cmd.pid -ne 0)) {
      $top = [FoxBoxNative]::FindBestByPids(@([uint32]$cmd.pid))
      if ($top -ne 0) {
        $raw = $top
        $hwnd = [IntPtr]$raw
      }
    }
    [FoxBoxNative]::EmbedAt($hwnd, [IntPtr]$owner, $x, $y, $w, $h)
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
