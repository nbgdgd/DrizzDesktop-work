param(
 [string]$Exe = "src-tauri\target\release\Drizz Desktop.exe",
 [int]$RestoreIndex = 1,
 [int[]]$Steps = @(2, 0)
)
# Hardware DPI test: temporarily changes the PRIMARY monitor scaling with the
# same call Windows Settings uses (SPI_SETLOGICALDPIOVERRIDE, index relative to
# the recommended value), captures the pet window at each step and always
# restores $RestoreIndex. Run only on a machine where a few seconds of screen
# flicker are acceptable.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class DpiSwitch {
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)]public struct R{public int L,T,Rt,B;}
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc f,IntPtr p);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")]public static extern IntPtr GetWindowLongPtrW(IntPtr h,int i);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 [DllImport("user32.dll")]public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern int GetWindowRgn(IntPtr h,IntPtr r);
 [DllImport("user32.dll")]public static extern bool SystemParametersInfoW(uint a,uint p,IntPtr v,uint f);
 [DllImport("user32.dll")]public static extern IntPtr MonitorFromWindow(IntPtr h,uint f);
 [DllImport("shcore.dll")]public static extern int GetDpiForMonitor(IntPtr h,int t,out uint x,out uint y);
 [DllImport("gdi32.dll")]public static extern IntPtr CreateRectRgn(int a,int b,int c,int d);
 [DllImport("gdi32.dll")]public static extern int GetRgnBox(IntPtr h,out R r);
 [DllImport("gdi32.dll")]public static extern bool DeleteObject(IntPtr h);
 public static IntPtr Find(int pid){IntPtr pet=IntPtr.Zero;EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==pid&&(GetWindowLongPtrW(h,-20).ToInt64()&0x08000000)!=0){pet=h;return false;}return true;},IntPtr.Zero);return pet;}
 public static uint MonitorDpi(IntPtr h){uint x,y;GetDpiForMonitor(MonitorFromWindow(h,1),0,out x,out y);return x;}
 public static bool SetScale(int index){return SystemParametersInfoW(0x009F,(uint)index,IntPtr.Zero,1);}
}
'@
[DpiSwitch]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
$qa = Join-Path $PSScriptRoot ("qa-dpi-" + [DateTime]::Now.Ticks)
New-Item -ItemType Directory -Force $qa | Out-Null
$env:LOCALAPPDATA = $qa
$proc = Start-Process -FilePath (Resolve-Path $Exe) -ArgumentList '--background','--diag' -PassThru
$results = @()
function Capture([string]$tag) {
  $pet = [DpiSwitch]::Find($proc.Id)
  if ($pet -eq [IntPtr]::Zero) { return [ordered]@{ Step=$tag; Error='no pet window' } }
  $r = [DpiSwitch+R]::new(); [DpiSwitch]::GetWindowRect($pet, [ref]$r) | Out-Null
  $rgn = [DpiSwitch]::CreateRectRgn(0,0,0,0); $kind = [DpiSwitch]::GetWindowRgn($pet, $rgn)
  $box = [DpiSwitch+R]::new(); [DpiSwitch]::GetRgnBox($rgn, [ref]$box) | Out-Null; [DpiSwitch]::DeleteObject($rgn) | Out-Null
  $w = $r.Rt - $r.L; $h = $r.B - $r.T
  $file = Join-Path $PSScriptRoot "dpi-$tag.png"
  if ($w -gt 0 -and $h -gt 0) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.L, $r.T, 0, 0, (New-Object System.Drawing.Size($w, $h)))
    $g.Dispose(); $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  }
  [ordered]@{ Step=$tag; Visible=[DpiSwitch]::IsWindowVisible($pet); WindowDpi=[DpiSwitch]::GetDpiForWindow($pet); MonitorDpi=[DpiSwitch]::MonitorDpi($pet); Window="$($r.L),$($r.T) $($w)x$($h)"; RegionKind=$kind; RegionBox="$($box.L),$($box.T)-$($box.Rt),$($box.B)"; Screenshot=$file }
}
try {
  Start-Sleep -Seconds 5
  $results += Capture "initial"
  foreach ($s in $Steps) {
    if (-not [DpiSwitch]::SetScale($s)) { throw "SPI_SETLOGICALDPIOVERRIDE($s) failed" }
    Start-Sleep -Seconds 5
    $results += Capture "index$s"
  }
} finally {
  [DpiSwitch]::SetScale($RestoreIndex) | Out-Null
  Start-Sleep -Seconds 5
  $results += Capture "restored"
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  $log = Join-Path $qa "DrizzDesktop\diagnostic.log"
  $results | ForEach-Object { [pscustomobject]$_ } | Format-List | Out-String -Width 200
  if (Test-Path $log) { "--- diagnostic.log (dpi/pose/mismatch lines) ---"; Get-Content $log | Where-Object { $_ -match 'dpi|pose|monitors|hidden' } }
}
