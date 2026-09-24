param([int]$AppPid)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Collections.Generic;using System.Runtime.InteropServices;
public static class PetWindows {
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)]public struct R { public int L,T,Rt,B; }
 [StructLayout(LayoutKind.Sequential)]public struct P { public int X,Y; public P(int x,int y){X=x;Y=y;} }
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc f,IntPtr p);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern IntPtr GetWindowLongPtrW(IntPtr h,int i);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern IntPtr WindowFromPoint(P p);
 [DllImport("user32.dll")]public static extern int GetWindowRgn(IntPtr h,IntPtr r);
 [DllImport("gdi32.dll")]public static extern IntPtr CreateRectRgn(int a,int b,int c,int d);
 [DllImport("gdi32.dll")]public static extern bool PtInRegion(IntPtr r,int x,int y);
 [DllImport("gdi32.dll")]public static extern bool DeleteObject(IntPtr o);
 public static IntPtr[] Find(int pid){var a=new List<IntPtr>();EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==pid)a.Add(h);return true;},IntPtr.Zero);return a.ToArray();}
}
'@
$pet=[PetWindows]::Find($AppPid) | Where-Object { ([PetWindows]::GetWindowLongPtrW($_,-20).ToInt64() -band 0x08000000) -ne 0 } | Select-Object -First 1
if(!$pet){throw 'No WS_EX_NOACTIVATE pet window'}
if(![PetWindows]::IsWindowVisible($pet)){throw 'Pet window is hidden'}
$rect=[PetWindows+R]::new();[PetWindows]::GetWindowRect($pet,[ref]$rect) | Out-Null
$rgn=[PetWindows]::CreateRectRgn(0,0,0,0)
try{
 $kind=[PetWindows]::GetWindowRgn($pet,$rgn)
 if($kind -le 1){throw 'Missing/non-complex pixel region'}
 if([PetWindows]::PtInRegion($rgn,1,1)){throw 'Transparent corner is intercepting input'}
 $hit=[PetWindows]::WindowFromPoint([PetWindows+P]::new($rect.L+1,$rect.T+1))
 if($hit -eq $pet){throw 'Transparent corner returns pet window'}
 $before=[PetWindows]::GetForegroundWindow()
 Start-Sleep -Milliseconds 1500
 $after=[PetWindows]::GetForegroundWindow()
 if($before -ne $after){throw 'Foreground changed while overlay was animating'}
 [pscustomobject]@{NoActivate=$true;Visible=$true;ComplexPixelRegion=$true;TransparentCornerPasses=$true;FocusStable=$true;Window=@{Left=$rect.L;Top=$rect.T;Right=$rect.Rt;Bottom=$rect.B}} | ConvertTo-Json -Depth 4
}finally{[PetWindows]::DeleteObject($rgn) | Out-Null}
