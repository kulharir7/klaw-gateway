param([string]$Action, [string]$Arg1)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class RootAIWindow {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    public const int SW_MINIMIZE = 6;
    public const int SW_MAXIMIZE = 3;
    public const int SW_RESTORE = 9;
    public const uint WM_CLOSE = 0x0010;

    public static void Minimize() {
        ShowWindow(GetForegroundWindow(), SW_MINIMIZE);
    }
    public static void Maximize() {
        ShowWindow(GetForegroundWindow(), SW_MAXIMIZE);
    }
    public static void Restore() {
        ShowWindow(GetForegroundWindow(), SW_RESTORE);
    }
    public static void Close() {
        PostMessage(GetForegroundWindow(), WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
    }
    public static void SnapLeft() {
        IntPtr hw = GetForegroundWindow();
        ShowWindow(hw, SW_RESTORE);
        int sw = GetSystemMetrics(0); // SM_CXSCREEN
        int sh = GetSystemMetrics(1); // SM_CYSCREEN
        MoveWindow(hw, 0, 0, sw / 2, sh, true);
    }
    public static void SnapRight() {
        IntPtr hw = GetForegroundWindow();
        ShowWindow(hw, SW_RESTORE);
        int sw = GetSystemMetrics(0);
        int sh = GetSystemMetrics(1);
        MoveWindow(hw, sw / 2, 0, sw / 2, sh, true);
    }
    public static string GetInfo() {
        IntPtr hw = GetForegroundWindow();
        RECT r;
        GetWindowRect(hw, out r);
        return String.Format("{0},{1},{2},{3}", r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
    }
}
'@

switch ($Action) {
    "minimize"  { [RootAIWindow]::Minimize() }
    "maximize"  { [RootAIWindow]::Maximize() }
    "restore"   { [RootAIWindow]::Restore() }
    "close"     { [RootAIWindow]::Close() }
    "snap_left" { [RootAIWindow]::SnapLeft() }
    "snap_right"{ [RootAIWindow]::SnapRight() }
    "info"      { [RootAIWindow]::GetInfo(); exit }
    default     { Write-Error "Unknown action: $Action" }
}
Write-Output "OK"
