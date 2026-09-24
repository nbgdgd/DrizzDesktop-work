const {chromium}=require('playwright');const cp=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const invoke=(page,cmd,args={})=>Promise.race([page.evaluate(({cmd,args})=>new Promise((resolve,reject)=>{const ok=Math.floor(Math.random()*0x3fffffff),err=ok+1;window['_'+ok]=r=>{delete window['_'+ok];delete window['_'+err];resolve(r)};window['_'+err]=e=>{delete window['_'+ok];delete window['_'+err];reject(e)};window.__TAURI_IPC__({cmd,callback:ok,error:err,...args});}),{cmd,args}),delay(10000).then(()=>{throw Error('IPC timeout: '+cmd)})]);
(async()=>{
 const exe=path.resolve('src-tauri/target/release/Drizz Desktop.exe');const qa=path.join(__dirname,'qa-'+Date.now());fs.mkdirSync(qa,{recursive:true});
 const app=cp.spawn(exe,['--background'],{windowsHide:true,env:{...process.env,LOCALAPPDATA:qa,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9224 --remote-debugging-address=127.0.0.1'}});
 let browser,pet;const errors=[];
 try{
  for(let i=0;i<30;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9224');break}catch{await delay(500)}}
  if(!browser)throw Error('WebView2 CDP not available');
  for(let i=0;i<30;i++){pet=browser.contexts().flatMap(c=>c.pages()).find(p=>!p.url().includes('panel=')&&p.url()!=='about:blank');if(pet)break;await delay(300)}
  if(!pet)throw Error('No pet page');pet.on('pageerror',e=>errors.push(e.message));
  await pet.waitForFunction(()=>typeof window.__TAURI_IPC__==='function');
  await pet.locator('canvas').waitFor();await delay(2000);
  await pet.screenshot({path:path.join(__dirname,'native-pet.png'),omitBackground:true});
  const result=cp.execFileSync('pwsh',['-NoProfile','-File',path.join(__dirname,'native-window-check.ps1'),'-AppPid',String(app.pid)],{encoding:'utf8',windowsHide:true});console.log(result);
  await invoke(pet,'open_panel',{tab:'settings'});await delay(700);
  const panel=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('panel='));if(!panel)throw Error('No settings window');panel.on('pageerror',e=>errors.push(e.message));
  await panel.getByRole('combobox',{name:'Активность'}).selectOption('active');await panel.getByRole('button',{name:'Сохранить',exact:true}).click();await panel.getByText('Сохранено',{exact:true}).waitFor();
  let store=await invoke(panel,'load_store');if(store.settings.activity!=='active')throw Error('Native setting did not save');
  await panel.screenshot({path:path.join(__dirname,'native-settings.png')});
  await invoke(panel,'save_settings',{settings:{...store.settings,integration:true,comments:true,mode:'normal'}});await delay(1500);
  const response=await fetch('http://127.0.0.1:49753/event',{method:'POST',headers:{Authorization:'Bearer '+store.token,'Content-Type':'application/json'},body:JSON.stringify({id:'native-test-1',kind:'build-success',title:'Test build'})});if(response.status!==204)throw Error('Integration POST failed '+response.status);
  const forbidden=await fetch('http://127.0.0.1:49753/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'native-test-2',kind:'build-success'})});if(forbidden.status!==400)throw Error('Unauthenticated event accepted');
  await invoke(panel,'save_memory',{memory:{...store.memory,address:'QA',facts:['test fact'],recent:[],lastGreeting:'',favorite:null,position:null}});
  await invoke(panel,'save_memory',{memory:{address:'',facts:[],recent:[],lastGreeting:'',favorite:null,position:null}});
  const backup=fs.readFileSync(path.join(qa,'DrizzDesktop','state.backup.json'),'utf8');if(backup.includes('test fact'))throw Error('Deleted fact remained in backup');
  await invoke(panel,'save_key',{key:'not-a-real-key-qa-only'});const bytes=fs.readFileSync(path.join(qa,'DrizzDesktop','credential.bin'));if(bytes.toString().includes('not-a-real-key'))throw Error('Plaintext key');await invoke(panel,'save_key',{key:''});if(fs.existsSync(path.join(qa,'DrizzDesktop','credential.bin')))throw Error('Key not removed');
  await invoke(panel,'save_settings',{settings:{...store.settings,integration:false,walk:false,pinned:false,perch:true,comments:false,hideFullscreen:true}});await delay(1000);
  const drag=cp.execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'native-drag-check.ps1'),'-AppPid',String(app.pid)],{encoding:'utf8',windowsHide:true});console.log(drag);
  await invoke(panel,'hide_pet');await delay(1000);await invoke(panel,'summon_pet');await delay(1000);
  await invoke(panel,'exit_app').catch(()=>{});await delay(800);if(app.exitCode===null)throw Error('Exit did not terminate application');
  if(errors.length)throw Error(errors.join('\n'));
  fs.writeFileSync(path.join(__dirname,'native-result.json'),JSON.stringify({ok:true,windows:JSON.parse(result),checks:['release EXE startup','noactivate style','pixel click-through region','foreground stability','native settings save','authenticated integration','reject missing token','memory backup deletion','DPAPI key storage + removal','hide + summon','real exit'],errors},null,2));
  console.log('Native smoke checks passed');
 }finally{if(app.exitCode===null){if(pet)await invoke(pet,'exit_app').catch(()=>{});await delay(300);if(app.exitCode===null)app.kill();}if(browser)await browser.close().catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1});
