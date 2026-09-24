import { tx } from "./i18n";
// Friendly program names for usage statistics and pet remarks.
const names: Record<string, string> = {
  "chrome.exe": "Chrome",
  "msedge.exe": "Edge",
  "firefox.exe": "Firefox",
  "opera.exe": "Opera",
  "brave.exe": "Brave",
  "vivaldi.exe": "Vivaldi",
  "code.exe": "VS Code",
  "devenv.exe": "Visual Studio",
  "idea64.exe": "IntelliJ IDEA",
  "rider64.exe": "Rider",
  "pycharm64.exe": "PyCharm",
  "godot.exe": "Godot",
  "blender.exe": "Blender",
  "discord.exe": "Discord",
  "telegram.exe": "Telegram",
  "explorer.exe": "Проводник",
  "steam.exe": "Steam",
  "vlc.exe": "VLC",
  "mpv.exe": "mpv",
  "potplayermini64.exe": "PotPlayer",
  "aniblaze.exe": "AniBlaze",
  "spotify.exe": "Spotify",
  "obs64.exe": "OBS",
  "photoshop.exe": "Photoshop",
  "figma.exe": "Figma",
  "notepad.exe": "Блокнот",
  "notepad++.exe": "Notepad++",
  "cmd.exe": "Командная строка",
  "powershell.exe": "PowerShell",
  "windowsterminal.exe": "Терминал",
  "excel.exe": "Excel",
  "winword.exe": "Word",
  "claude.exe": "Claude",
  "drizz desktop.exe": "Drizz",
};
export function appName(exe: string): string {
  const key = exe.trim().toLowerCase();
  if (!key) return tx("что-то");
  return names[key] ? tx(names[key]) : key.replace(/\.exe$/, "");
}
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return tx("меньше минуты");
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  if (!h) return tx("{m} мин", { m });
  return m ? tx("{h} ч {m} мин", { h, m }) : tx("{h} ч", { h });
}
