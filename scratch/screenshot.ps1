Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$Screen = [System.Windows.Forms.Screen]::PrimaryScreen
$Width = $Screen.Bounds.Width
$Height = $Screen.Bounds.Height
$Bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
$Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
$Graphics.CopyFromScreen(0, 0, 0, 0, $Bitmap.Size)
$MS = New-Object System.IO.MemoryStream
$Bitmap.Save($MS, [System.Drawing.Imaging.ImageFormat]::Png)
$Bytes = $MS.ToArray()
[Convert]::ToBase64String($Bytes)
$Graphics.Dispose()
$Bitmap.Dispose()
$MS.Dispose()
