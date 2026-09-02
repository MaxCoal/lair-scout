param(
  [Parameter(Mandatory = $false)]
  [string]$Title = "",
  [Parameter(Mandatory = $false)]
  [Int64]$Handle = 0,
  [Parameter(Mandatory = $false)]
  [ValidateSet('find', 'hide', 'show')]
  [string]$Action = 'find'
)

if (-not ('FoxBoxNative' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FoxBoxNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
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

$hwnd = [IntPtr]::Zero
if ($Handle -ne 0) {
  $hwnd = [IntPtr]$Handle
} elseif ($Title -ne "") {
  $hwnd = [IntPtr][FoxBoxNative]::FindByTitle($Title)
}

if ($hwnd -eq [IntPtr]::Zero) {
  Write-Output "0"
  exit 0
}

if (-not [FoxBoxNative]::IsWindow($hwnd)) {
  Write-Output "0"
  exit 0
}

$SWP_NOSIZE = 0x0001
$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010

if ($Action -eq "hide") {
  [void][FoxBoxNative]::ShowWindow($hwnd, 0)
  [void][FoxBoxNative]::SetWindowPos($hwnd, [IntPtr]::Zero, -32000, -32000, 0, 0, ($SWP_NOSIZE -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE))
} elseif ($Action -eq "show") {
  [void][FoxBoxNative]::SetWindowPos($hwnd, [IntPtr]::Zero, 80, 80, 1280, 720, $SWP_NOZORDER)
  [void][FoxBoxNative]::ShowWindow($hwnd, 9)
  [void][FoxBoxNative]::SetForegroundWindow($hwnd)
}

Write-Output $hwnd.ToInt64()
