# ASCII source is intentional: Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'winrt.ps1')
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.UI.Notifications.UserNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Concurrent;
using System.Threading;
public static class PetCommandQueue {
  static BlockingCollection<string> queue = new BlockingCollection<string>();
  public static volatile bool Closed;
  public static void Start() {
    var thread = new Thread(() => {
      try { string line; while ((line = Console.In.ReadLine()) != null) queue.Add(line); }
      finally { Closed = true; }
    });
    thread.IsBackground = true; thread.Start();
  }
  public static string Next() { string line; return queue.TryTake(out line) ? line : null; }
}
public static class PetMediaKey {
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out IntPtr result);
  public static bool SendToPlayer(string name, int command) {
    foreach (var process in System.Diagnostics.Process.GetProcessesByName(name)) {
      try {
        var window = process.MainWindowHandle;
        if (window == IntPtr.Zero) continue;
        IntPtr result;
        if (SendMessageTimeout(window, 0x0319, window, new IntPtr(command << 16), 2, 1000, out result) != IntPtr.Zero && result != IntPtr.Zero) return true;
      } finally { process.Dispose(); }
    }
    return false;
  }
  [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  public static void Send(byte key) {
    keybd_event(key, 0, 0, UIntPtr.Zero);
    keybd_event(key, 0, 2, UIntPtr.Zero);
  }
}
'@
$config = @{ music = $false; notifications = $false; codex = $false; details = $false; excludedPids = @(); excludedMediaIds = @() }
$manager = $null
$coverCache = @{}
function Get-Cover($properties) {
  if (-not $properties.Thumbnail) { return @{ value = $null; status = 'unavailable' } }
  $stream = $null; $inputStream = $null; $memory = $null; $image = $null; $bitmap = $null; $graphics = $null; $output = $null
  try {
    [void][Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
    [void][Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $stream = Await-WinRT ($properties.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $randomType = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $size = $randomType.GetProperty('Size').GetValue($stream,$null)
    if ($size -eq 0 -or $size -gt 16777216) { return @{ value = $null; status = 'unavailable' } }
    # Managed streams avoid PowerShell WinRT output-array marshaling; normalize artwork locally.
    $input = $randomType.GetMethod('GetInputStreamAt').Invoke($stream,@([uint64]0))
    $inputStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead([Windows.Storage.Streams.IInputStream]$input)
    $memory = [System.IO.MemoryStream]::new()
    $inputStream.CopyTo($memory); $memory.Position = 0
    Add-Type -AssemblyName System.Drawing
    $image = [System.Drawing.Image]::FromStream($memory)
    $ratio = [Math]::Min(1, 256.0 / [Math]::Max($image.Width, $image.Height))
    $bitmap = [System.Drawing.Bitmap]::new([Math]::Max(1,[int]($image.Width*$ratio)), [Math]::Max(1,[int]($image.Height*$ratio)))
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($image,0,0,$bitmap.Width,$bitmap.Height)
    $output = [System.IO.MemoryStream]::new()
    $bitmap.Save($output,[System.Drawing.Imaging.ImageFormat]::Png)
    return @{ value = 'data:image/png;base64,'+[Convert]::ToBase64String($output.ToArray()); status = 'available' }
  } catch { return @{ value = $null; status = 'read-error'; diagnostic = $_.Exception.GetType().Name } }
  finally { foreach ($resource in @($graphics,$bitmap,$image,$output,$memory,$inputStream,$stream)) { if ($resource) { try { $resource.Dispose() } catch {} } } }
}
function Get-Media {
  if (-not $script:manager) {
    $script:manager = Await-WinRT ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  }
  $current = $script:manager.GetCurrentSession()
  $items = @(foreach ($session in $script:manager.GetSessions()) {
    $id = [string]$session.SourceAppUserModelId
    if ($id -in $script:config.excludedMediaIds -or $id -match '(?i)spine.?pet.?workshop') { continue }
    try {
      $properties = Await-WinRT ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $playback = $session.GetPlaybackInfo(); $timeline = $session.GetTimelineProperties()
      $key = $id+':'+$properties.Title+':'+$properties.Artist
      $cached = $script:coverCache[$key]
      if (-not $cached -or ($cached.status -ne 'available' -and $cached.retryAt -lt [DateTime]::UtcNow)) {
        if ($script:coverCache.Count -ge 16) { $script:coverCache.Clear() }
        $cached = Get-Cover $properties
        $cached.retryAt = [DateTime]::UtcNow.AddSeconds(10); $script:coverCache[$key] = $cached
      }
      @{
        id = $id; title = $properties.Title; artist = $properties.Artist; album = $properties.AlbumTitle
        name = if ($id -match '(?i)qqmusic') { 'QQ Music' } elseif ($id -match '(?i)cloudmusic|netease') { 'NetEase Music' } else { $id }
        status = [string]$playback.PlaybackStatus; cover = $cached.value; coverStatus = $cached.status
        position = $timeline.Position.TotalSeconds; duration = $timeline.EndTime.TotalSeconds
        timelineUpdatedAt = $timeline.LastUpdatedTime.ToString('o')
        capabilities = @{ play = $playback.Controls.IsPlayEnabled; pause = $playback.Controls.IsPauseEnabled
          next = $playback.Controls.IsNextEnabled; previous = $playback.Controls.IsPreviousEnabled }
      }
    } catch { continue }
  })
  foreach ($processName in @('cloudmusic','QQMusic')) {
    $pattern = if ($processName -eq 'cloudmusic') { '(?i)cloudmusic|netease' } else { '(?i)qqmusic' }
    $hasSession = $items | Where-Object { $_.id -match $pattern } | Select-Object -First 1
    $player = Get-Process -Name $processName -ErrorAction SilentlyContinue | Select-Object -First 1
    $otherPlaying = [bool]($items | Where-Object { $_.status -eq 'Playing' -and -not $_.fallback } | Select-Object -First 1)
    if ($player -and -not $hasSession) {
      $items += @{ id = 'app-command:'+$processName; name = if ($processName -eq 'cloudmusic') { 'NetEase Music' } else { 'QQ Music' }
        title = ''; artist = ''; album = ''; status = 'Unknown'; cover = $null; coverStatus = 'unavailable'
        position = 0; duration = 0; capabilities = @{ play = -not $otherPlaying; pause = -not $otherPlaying; next = -not $otherPlaying; previous = -not $otherPlaying }
        fallback = $true; fallbackReason = if ($otherPlaying) { 'other-player-active' } else { '' } }
    }
  }
  @{ sessions = $items; currentId = if ($current) { $current.SourceAppUserModelId } else { $null }; error = $null }
}
function Get-Notices {
  $listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
  $permission = [string]$listener.GetAccessStatus()
  $items = @()
  if ($permission -eq 'Allowed') {
    $listType = [System.Collections.Generic.IReadOnlyList``1].MakeGenericType([Windows.UI.Notifications.UserNotification])
    $notices = Await-WinRT ($listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) $listType
    $items = @(foreach ($notice in $notices) {
      $texts = @()
      if ($script:config.details) {
        $binding = $notice.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric)
        if (-not $binding) { $binding = $notice.Notification.Visual.Bindings | Select-Object -First 1 }
        if ($binding) { $texts = @($binding.GetTextElements() | ForEach-Object { $_.Text }) }
      }
      @{ id = [string]$notice.Id; app = $notice.AppInfo.DisplayInfo.DisplayName
        appId = $notice.AppInfo.AppUserModelId; createdAt = $notice.CreationTime.ToString('o')
        title = if ($texts.Count -gt 0) { $texts[0] } else { '' }
        body = if ($texts.Count -gt 1) { ($texts | Select-Object -Skip 1) -join ' ' } else { '' } }
    })
  }
  @{ permission = $permission; items = $items; error = $null
    runningApps = @(Get-Process -Name QQ,WXWork,WeChat,Weixin -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName -Unique) }
}
function Handle-Command($message) {
  if ($message.method -eq 'configure') {
    $script:config = $message.params
    if (-not $script:config.music) { $script:manager = $null; $script:coverCache.Clear() }
    return
  }
  $result = $false
  try {
    if ($message.method -eq 'media') {
      if (-not $script:config.music) { throw 'Music is disabled.' }
      $action = [string]$message.params.action
      if ($action -notin @('play','pause','toggle','next','previous')) { throw 'Invalid media action.' }
      if ([string]$message.params.sessionId -like 'app-command:*') {
        $playerName = ([string]$message.params.sessionId).Substring(12)
        if ($playerName -notin @('cloudmusic','QQMusic')) { throw 'Invalid player.' }
        $others = (Get-Media).sessions | Where-Object { -not $_.fallback -and $_.status -eq 'Playing' }
        if ($others) { throw 'Another media session is active. Compatibility control is blocked to avoid controlling the wrong player.' }
        $command = switch ($action) { 'next' { 11 } 'previous' { 12 } 'play' { 46 } 'pause' { 47 } default { 14 } }
        $result = [PetMediaKey]::SendToPlayer($playerName,$command)
        if (-not $result) { throw 'Player does not expose this control. Enable system media integration in the player.' }
      } elseif ($message.params.sessionId -eq 'system-media-key') {
        $key = switch ($action) { 'next' { 0xB0 } 'previous' { 0xB1 } default { 0xB3 } }
        [PetMediaKey]::Send([byte]$key)
        $result = $true
      } else {
        if (-not $script:manager) { [void](Get-Media) }
        $session = $script:manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -eq $message.params.sessionId } | Select-Object -First 1
        if (-not $session) { throw 'Media session has closed.' }
        if ($action -eq 'toggle') {
          $action = if ([string]$session.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { 'pause' } else { 'play' }
        }
        $op = switch ($action) {
          'play' { $session.TryPlayAsync() } 'pause' { $session.TryPauseAsync() }
          'next' { $session.TrySkipNextAsync() } 'previous' { $session.TrySkipPreviousAsync() }
        }
        $result = Await-WinRT $op ([bool])
      }
    } elseif ($message.method -eq 'permission') {
      if (-not $script:config.notifications) { throw 'Notifications are disabled.' }
      $listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
      $result = [string](Await-WinRT ($listener.RequestAccessAsync()) ([Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus]))
    }
    Emit @{ type = 'reply'; id = $message.id; result = $result }
  } catch { Emit @{ type = 'reply'; id = $message.id; error = $_.Exception.Message } }
}
[PetCommandQueue]::Start()
$nextSample = [DateTime]::UtcNow
while ($true) {
  $line = [PetCommandQueue]::Next()
  if ($null -ne $line) {
    try { Handle-Command ($line | ConvertFrom-Json) } catch { }
    $nextSample = [DateTime]::UtcNow
  } elseif ([PetCommandQueue]::Closed) { break }
  if ([DateTime]::UtcNow -ge $nextSample) {
    $snapshot = @{ type = 'snapshot'; locked = [bool](Get-Process -Name LogonUI -ErrorAction SilentlyContinue) }
    if ($config.music) {
      try { $snapshot.media = Get-Media } catch { $snapshot.media = @{ sessions = @(); error = $_.Exception.Message } }
    }
    if ($config.notifications) {
      try { $snapshot.notifications = Get-Notices } catch { $snapshot.notifications = @{ permission = 'Error'; items = @(); error = $_.Exception.Message } }
    }
    if ($config.codex) {
      $desktop = Get-Process -Name 'ChatGPT','Codex Desktop' -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -eq 'Codex Desktop' -or $_.Path -like '*Codex*'
      } | Select-Object -First 1
      $cli = if (-not $desktop) {
        Get-CimInstance Win32_Process -Filter "Name = 'codex.exe'" -ErrorAction SilentlyContinue | Where-Object {
          $_.ProcessId -notin $config.excludedPids -and $_.CommandLine -notmatch '\bapp-server\b'
        } | Select-Object -First 1
      } else { $null }
      $snapshot.codexRunning = [bool]($desktop -or $cli)
    }
    Emit $snapshot
    $nextSample = [DateTime]::UtcNow.AddSeconds(2)
  }
  Start-Sleep -Milliseconds 100
}
