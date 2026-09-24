param(
 [Parameter(Mandatory=$true)][ValidateSet('build-success','build-failed','render-done','download-done','episode-ended')][string]$Kind,
 [string]$Title='',
 [string]$Id=[Guid]::NewGuid().ToString()
)
$ErrorActionPreference='Stop'
$statePath=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'DrizzDesktop\state.json'
if(!(Test-Path -LiteralPath $statePath)){throw 'Сначала запустите Drizz Desktop.'}
$state=Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
if(!$state.settings.integration){throw 'Включите «События от программ» в настройках Drizz и сохраните.'}
$body=@{kind=$Kind;title=$Title;id=$Id} | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:49753/event' -Headers @{Authorization=('Bearer '+$state.token)} -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 5
