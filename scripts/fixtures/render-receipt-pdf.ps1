param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]
$operationAdapter = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
  $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
$actionAdapter = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
} | Select-Object -First 1
function Await-Operation($Operation, [Type]$ResultType) {
  $task = $operationAdapter.MakeGenericMethod($ResultType).Invoke($null,@($Operation))
  [void]$task.Wait()
  return $task.Result
}
function Await-Action($Action) {
  $task = $actionAdapter.Invoke($null,@($Action))
  [void]$task.Wait()
}
$source = (Get-Item -LiteralPath $InputPath).FullName
$destination = (Get-Item -LiteralPath $OutputDirectory).FullName
$file = Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($source)) ([Windows.Storage.StorageFile])
$pdf = Await-Operation ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
if ($pdf.PageCount -lt 1 -or $pdf.PageCount -gt 10) { throw 'Unexpected receipt PDF page count' }
$pages = @()
for ($index=0; $index -lt $pdf.PageCount; $index++) {
  $page = $pdf.GetPage($index)
  $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  try {
    Await-Action ($page.RenderToStreamAsync($stream))
    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    try {
      [void](Await-Operation ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]))
      $bytes = New-Object byte[] ([int]$stream.Size)
      $reader.ReadBytes($bytes)
      if ($bytes.Length -lt 100 -or $bytes[0] -ne 137 -or $bytes[1] -ne 80 -or $bytes[2] -ne 78 -or $bytes[3] -ne 71) { throw 'PDF renderer did not produce PNG' }
      $path = Join-Path $destination ('receipt-page-' + ($index+1) + '.png')
      [System.IO.File]::WriteAllBytes($path,$bytes)
      $pages += [ordered]@{page=$index+1; width=$page.Size.Width; height=$page.Size.Height; png=$path; bytes=$bytes.Length}
    } finally { $reader.Dispose() }
  } finally { $stream.Dispose(); $page.Dispose() }
}
[ordered]@{renderer='Windows.Data.Pdf'; opened=$true; pageCount=$pdf.PageCount; pages=$pages} | ConvertTo-Json -Depth 5 -Compress
