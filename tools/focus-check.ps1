param([int]$AppPid, [int]$Clicks = 3)
# Clicks the pet with synthetic input and verifies the foreground window is
# unchanged afterwards (WS_EX_NOACTIVATE must hold through WebView2 clicks).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public static class FocusQA {
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)]public struct R{public int L,T,Rt,B;}
 [StructLayout(LayoutKind.Sequential)]public struct P{public int X,Y;}
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc f,IntPtr p);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")]public static extern IntPtr GetWindowLongPtrW(IntPtr h,int i);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern bool GetCursorPos(out P p);
 [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]public static extern void mouse_event(uint flags,uint x,uint y,uint d,UIntPtr extra);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 [DllImport("user32.dll")]public static extern int GetWindowRgn(IntPtr h,IntPtr r);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetClassNameW(IntPtr h,StringBuilder s,int n);
 [DllImport("gdi32.dll")]public static extern IntPtr CreateRectRgn(int a,int b,int c,int d);
 [DllImport("gdi32.dll")]public static extern int GetRgnBox(IntPtr h,out R r);
 [DllImport("gdi32.dll")]public static extern bool DeleteObject(IntPtr h);
 public static IntPtr Find(int pid){IntPtr pet=IntPtr.Zero;EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==pid&&IsWindowVisible(h)&&(GetWindowLongPtrW(h,-20).ToInt64()&0x08000000)!=0){pet=h;return false;}return true;},IntPtr.Zero);return pet;}
 public static R Shape(IntPtr h){R win,shape;GetWindowRect(h,out win);var r=CreateRectRgn(0,0,0,0);GetWindowRgn(h,r);GetRgnBox(r,out shape);DeleteObject(r);shape.L+=win.L;shape.Rt+=win.L;shape.T+=win.T;shape.B+=win.T;return shape;}
 public static string Describe(IntPtr h){var sb=new StringBuilder(128);GetClassNameW(h,sb,128);uint pid;GetWindowThreadProcessId(h,out pid);return sb.ToString()+" pid "+pid;}
}
'@
[FocusQA]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
$pet = [FocusQA]::Find($AppPid); if ($pet -eq [IntPtr]::Zero) { throw 'Missing pet' }
$cursor = [FocusQA+P]::new(); [FocusQA]::GetCursorPos([ref]$cursor) | Out-Null
$form = New-Object System.Windows.Forms.Form; $form.Text = 'Drizz focus probe'; $form.StartPosition = 'Manual'
$form.Bounds = New-Object Drawing.Rectangle(200, 200, 500, 300)
function Pump([int]$ms){$until=[DateTime]::UtcNow.AddMilliseconds($ms);while([DateTime]::UtcNow -lt $until){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 20}}
try {
  $form.Show(); $form.Activate(); Pump 1200
  $before = [FocusQA]::GetForegroundWindow()
  $out = [ordered]@{ FormIsForeground = ($before -eq $form.Handle); Results = @() }
  for ($i = 0; $i -lt $Clicks; $i++) {
    $s = [FocusQA]::Shape($pet); $x = [int](($s.L + $s.Rt) / 2); $y = [int]($s.B - 30)
    [FocusQA]::SetCursorPos($x, $y) | Out-Null; Pump 120
    [FocusQA]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Pump 80; [FocusQA]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Pump 700
    $fg = [FocusQA]::GetForegroundWindow()
    $out.Results += [ordered]@{ Click = $i + 1; At = "$x,$y"; ForegroundUnchanged = ($fg -eq $before); PetIsForeground = ($fg -eq $pet); Foreground = [FocusQA]::Describe($fg) }
  }
  $out | ConvertTo-Json -Depth 4
} finally {
  $form.Close(); $form.Dispose(); [FocusQA]::SetCursorPos($cursor.X, $cursor.Y) | Out-Null
}
