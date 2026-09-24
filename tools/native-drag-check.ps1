param([int]$AppPid)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class DragQA {
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
 [DllImport("gdi32.dll")]public static extern IntPtr CreateRectRgn(int a,int b,int c,int d);
 [DllImport("gdi32.dll")]public static extern int GetRgnBox(IntPtr h,out R r);
 [DllImport("gdi32.dll")]public static extern bool DeleteObject(IntPtr h);
 [DllImport("dwmapi.dll")]public static extern int DwmGetWindowAttribute(IntPtr h,uint attr,out R r,int size);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetClassNameW(IntPtr h,System.Text.StringBuilder s,int n);
 public static string Describe(IntPtr h){var sb=new System.Text.StringBuilder(128);GetClassNameW(h,sb,128);uint pid;GetWindowThreadProcessId(h,out pid);return sb.ToString()+" pid "+pid;}
 public static IntPtr Find(int pid){IntPtr pet=IntPtr.Zero;EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==pid&&IsWindowVisible(h)&&(GetWindowLongPtrW(h,-20).ToInt64()&0x08000000)!=0){pet=h;return false;}return true;},IntPtr.Zero);return pet;}
 public static R Shape(IntPtr h){R win,shape;GetWindowRect(h,out win);var r=CreateRectRgn(0,0,0,0);GetWindowRgn(h,r);GetRgnBox(r,out shape);DeleteObject(r);shape.L+=win.L;shape.Rt+=win.L;shape.T+=win.T;shape.B+=win.T;return shape;}
}
'@
[DragQA]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
$pet=[DragQA]::Find($AppPid);if($pet -eq [IntPtr]::Zero){throw 'Missing pet'}
$cursor=[DragQA+P]::new();[DragQA]::GetCursorPos([ref]$cursor)|Out-Null;$previous=[DragQA]::GetForegroundWindow()
$form=New-Object System.Windows.Forms.Form;$form.Text='Drizz test support';$form.StartPosition='Manual';$form.AutoScaleMode='None';$form.BackColor=[Drawing.Color]::FromArgb(44,46,51)
$area=[Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Bounds=New-Object Drawing.Rectangle(($area.Left+300),($area.Top+350),700,360)
function Pump([int]$ms){$until=[DateTime]::UtcNow.AddMilliseconds($ms);while([DateTime]::UtcNow -lt $until){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 20}}
try{
 $form.Show();$form.Activate();Pump 1300
 $source=[DragQA]::Shape($pet);$x=[int](($source.L+$source.Rt)/2);$y=[int]($source.B-40)
 $support=[DragQA+R]::new();[DragQA]::DwmGetWindowAttribute($form.Handle,9,[ref]$support,16)|Out-Null
 [DragQA]::SetCursorPos($x,$y)|Out-Null;Pump 150
 [DragQA]::mouse_event(2,0,0,0,[UIntPtr]::Zero);Pump 100
 $targetX=$support.L+300;$targetY=$support.T-75
 for($i=1;$i -le 25;$i++){[DragQA]::SetCursorPos([int]($x+($targetX-$x)*$i/25),[int]($y+($targetY-$y)*$i/25))|Out-Null;Pump 35}
 [DragQA]::mouse_event(4,0,0,0,[UIntPtr]::Zero);Pump 1900
 $landed=[DragQA]::Shape($pet)
 if([Math]::Abs($landed.B-$support.T) -gt 7){throw "Did not land on window: feet=$($landed.B), top=$($support.T)"}
 $fg=[DragQA]::GetForegroundWindow()
 if($fg -eq $pet){throw 'Drag activated the pet window'}
 if($fg -ne $form.Handle){throw ("Foreground changed during drag to: "+[DragQA]::Describe($fg)+" (pet window not activated)")}
 $form.Location=New-Object Drawing.Point(($form.Left+80),($form.Top+60));Pump 900
 $moved=[DragQA]::Shape($pet)
 if(([Math]::Abs(($moved.B-$landed.B)-60) -gt 7) -or ([Math]::Abs(($moved.L-$landed.L)-80) -gt 12)){throw 'Pet did not follow moved support'}
 $form.WindowState='Minimized';Pump 2100
 $fallen=[DragQA]::Shape($pet)
 if([Math]::Abs($fallen.B-$area.Bottom) -gt 7){throw "Pet hung after minimizing support: $($fallen.B) versus $($area.Bottom)"}
 $form.WindowState='Normal';$form.FormBorderStyle='None';$form.Bounds=[Windows.Forms.Screen]::PrimaryScreen.Bounds;$form.Activate();Pump 1700
 if([DragQA]::IsWindowVisible($pet)){throw 'Fullscreen did not hide pet'}
 $form.WindowState='Minimized';Pump 1700
 if(![DragQA]::IsWindowVisible($pet)){throw 'Pet failed to return after fullscreen'}
 [pscustomobject]@{RealDrag=$true;LandedOnWindow=$true;FollowedMovedWindow=$true;FellAfterMinimize=$true;DragKeptFocus=$true;FullscreenHid=$true;ReturnedAfterFullscreen=$true}|ConvertTo-Json
}finally{
 [DragQA]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
 $form.Close();$form.Dispose();[DragQA]::SetCursorPos($cursor.X,$cursor.Y)|Out-Null;[DragQA]::SetForegroundWindow($previous)|Out-Null
}
