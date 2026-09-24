param(
 [string]$Exe = "src-tauri\target\release\Drizz Desktop.exe",
 [string]$Profile = "",
 [int]$WaitMs = 5000,
 [string]$Out = "tools\desktop-pet.png",
 [switch]$Keep,
 [int]$AppPid = 0
)
# Captures the real screen pixels of the pet window (DPI-aware, physical
# coordinates) so visibility is verified on the desktop, not inside WebView2.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class ShotQA {
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
 [DllImport("gdi32.dll")]public static extern IntPtr CreateRectRgn(int a,int b,int c,int d);
 [DllImport("gdi32.dll")]public static extern int GetRgnBox(IntPtr h,out R r);
 [DllImport("gdi32.dll")]public static extern bool DeleteObject(IntPtr h);
 public static IntPtr Find(int pid){IntPtr pet=IntPtr.Zero;EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==pid&&(GetWindowLongPtrW(h,-20).ToInt64()&0x08000000)!=0){pet=h;return false;}return true;},IntPtr.Zero);return pet;}
}
'@
[ShotQA]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
$proc = $null
if ($AppPid -eq 0) {
  if (-not $Profile) { $Profile = Join-Path $PSScriptRoot ("qa-shot-" + [DateTime]::Now.Ticks) }
  New-Item -ItemType Directory -Force $Profile | Out-Null
  $env:LOCALAPPDATA = $Profile
  $proc = Start-Process -FilePath (Resolve-Path $Exe) -ArgumentList '--background' -PassThru
  $AppPid = $proc.Id
  Start-Sleep -Milliseconds $WaitMs
}
try {
  $pet = [ShotQA]::Find($AppPid)
  if ($pet -eq [IntPtr]::Zero) { throw "No WS_EX_NOACTIVATE window for PID $AppPid" }
  $r = [ShotQA+R]::new(); [ShotQA]::GetWindowRect($pet, [ref]$r) | Out-Null
  $rgn = [ShotQA]::CreateRectRgn(0,0,0,0); $kind = [ShotQA]::GetWindowRgn($pet, $rgn)
  $box = [ShotQA+R]::new(); [ShotQA]::GetRgnBox($rgn, [ref]$box) | Out-Null; [ShotQA]::DeleteObject($rgn) | Out-Null
  $info = [ordered]@{ Visible=[ShotQA]::IsWindowVisible($pet); Dpi=[ShotQA]::GetDpiForWindow($pet); Window=@{L=$r.L;T=$r.T;R=$r.Rt;B=$r.B;W=($r.Rt-$r.L);H=($r.B-$r.T)}; RegionKind=$kind; RegionBox=@{L=$box.L;T=$box.T;R=$box.Rt;B=$box.B} }
  $w = $r.Rt - $r.L; $h = $r.B - $r.T
  if ($w -gt 0 -and $h -gt 0) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.L, $r.T, 0, 0, (New-Object System.Drawing.Size($w, $h)))
    $g.Dispose()
    $full = Join-Path (Get-Location) $Out
    $bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    $info.Screenshot = $full
  }
  $info | ConvertTo-Json -Depth 4
} finally {
  if ($proc -and -not $Keep) { Stop-Process -Id $AppPid -Force -ErrorAction SilentlyContinue }
}
