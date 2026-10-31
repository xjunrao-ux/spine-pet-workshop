param([Parameter(Mandatory=$true)][string]$ShortcutPath)
$ErrorActionPreference = 'Stop'
$resolvedShortcut = (Resolve-Path -LiteralPath $ShortcutPath).Path
if ([IO.Path]::GetExtension($resolvedShortcut) -ine '.lnk') { throw 'Expected a shortcut file' }
Add-Type @'
using System.Runtime.InteropServices;
public static class SpinePetShortcutNotify {
 [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
 public static extern void SHChangeNotify(uint eventId, uint flags, string item, string secondItem);
}
'@
[SpinePetShortcutNotify]::SHChangeNotify(0x00002000,0x00001005,$resolvedShortcut,$null)
