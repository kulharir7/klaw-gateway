Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ActiveWin {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    public static string GetTitle() {
        IntPtr h = GetForegroundWindow();
        StringBuilder sb = new StringBuilder(256);
        GetWindowText(h, sb, 256);
        return sb.ToString();
    }
    public static uint GetPid() {
        IntPtr h = GetForegroundWindow();
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        return pid;
    }
}
'@
$title = [ActiveWin]::GetTitle()
$pid = [ActiveWin]::GetPid()
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
Write-Output "$($proc.ProcessName)|$title"