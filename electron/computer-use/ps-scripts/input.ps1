param([string]$Action, [string]$Arg1, [string]$Arg2)

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class RootAIInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
    
    public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
    public const uint MOUSEEVENTF_LEFTUP = 0x04;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x08;
    public const uint MOUSEEVENTF_RIGHTUP = 0x10;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    
    public static void LeftClick(int x, int y) {
        SetCursorPos(x, y);
        Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        Thread.Sleep(30);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    }
    
    public static void RightClick(int x, int y) {
        SetCursorPos(x, y);
        Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
        Thread.Sleep(30);
        mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
    }
    
    public static void DoubleClick(int x, int y) {
        SetCursorPos(x, y);
        Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        Thread.Sleep(80);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    }
    
    public static void ScrollWheel(int clicks) {
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)(clicks * 120), 0);
    }
    
    public static void MoveTo(int x, int y) {
        SetCursorPos(x, y);
    }
    
    public static void Drag(int x1, int y1, int x2, int y2) {
        SetCursorPos(x1, y1);
        Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        Thread.Sleep(50);
        // Move in small steps for smooth drag
        int steps = 10;
        for (int i = 1; i <= steps; i++) {
            int cx = x1 + (x2 - x1) * i / steps;
            int cy = y1 + (y2 - y1) * i / steps;
            SetCursorPos(cx, cy);
            Thread.Sleep(20);
        }
        Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    }
}
'@

switch ($Action) {
    "leftclick"   { [RootAIInput]::LeftClick([int]$Arg1, [int]$Arg2) }
    "rightclick"  { [RootAIInput]::RightClick([int]$Arg1, [int]$Arg2) }
    "doubleclick" { [RootAIInput]::DoubleClick([int]$Arg1, [int]$Arg2) }
    "scroll"      { [RootAIInput]::ScrollWheel([int]$Arg1) }
    "move"        { [RootAIInput]::MoveTo([int]$Arg1, [int]$Arg2) }
    "drag"        { 
        $coords = $Arg1 -split ','
        [RootAIInput]::Drag([int]$coords[0], [int]$coords[1], [int]$coords[2], [int]$coords[3])
    }
    default       { Write-Error "Unknown action: $Action" }
}
Write-Output "OK"