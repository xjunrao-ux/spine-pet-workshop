param(
    [Parameter(Mandatory = $true)]
    [int]$ExcludePid
)

$source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class DesktopWindowScanner
{
    public sealed class WindowInfo
    {
        public int X { get; set; }
        public int Y { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
        public uint Pid { get; set; }
        public string Title { get; set; }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    public static List<WindowInfo> GetWindows(int excludedPid)
    {
        var result = new List<WindowInfo>();
        EnumWindows((hWnd, _) =>
        {
            if (!IsWindowVisible(hWnd) || IsIconic(hWnd)) return true;

            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid == excludedPid) return true;

            var titleLength = GetWindowTextLength(hWnd);
            if (titleLength <= 0) return true;

            RECT rect;
            if (!GetWindowRect(hWnd, out rect)) return true;
            var width = rect.Right - rect.Left;
            var height = rect.Bottom - rect.Top;
            if (width < 120 || height < 60) return true;

            var title = new StringBuilder(titleLength + 1);
            GetWindowText(hWnd, title, title.Capacity);
            result.Add(new WindowInfo
            {
                X = rect.Left,
                Y = rect.Top,
                Width = width,
                Height = height,
                Pid = pid,
                Title = title.ToString()
            });
            return true;
        }, IntPtr.Zero);

        return result;
    }
}
'@

Add-Type -TypeDefinition $source -Language CSharp

while ($true) {
    $windows = @([DesktopWindowScanner]::GetWindows($ExcludePid))
    ConvertTo-Json -InputObject $windows -Compress -Depth 3
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 650
}
