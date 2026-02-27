param([string]$ProcessName)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class FocusWin {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
'@

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($proc) {
    [FocusWin]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
    [FocusWin]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    Write-Output "OK"
} else {
    Write-Output "NOT_FOUND"
}