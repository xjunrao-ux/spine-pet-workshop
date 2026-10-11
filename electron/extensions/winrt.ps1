$script:AsTask = $null
function Await-WinRT($Operation, [Type]$ResultType) {
  if (-not $script:AsTask) {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $script:AsTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
    } | Select-Object -First 1
  }
  $task = $script:AsTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.GetAwaiter().GetResult()
}
function Emit($Value) {
  [Console]::Out.WriteLine(($Value | ConvertTo-Json -Depth 14 -Compress))
  [Console]::Out.Flush()
}
