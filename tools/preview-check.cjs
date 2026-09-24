const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const {createServer}=await import('vite');
 const server=await createServer({server:{host:'127.0.0.1',port:1421,strictPort:true}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:720,height:670},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)});
 try{
  await page.goto('http://127.0.0.1:1421/?panel=settings');
  await page.getByRole('heading',{name:'Питомец',exact:true}).waitFor();
  await page.getByRole('combobox',{name:'Персонаж'}).selectOption('drizz');
  await page.screenshot({path:path.join(__dirname,'settings.png')});
  await page.getByRole('combobox',{name:'Активность'}).selectOption('active');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.getByText('Сохранено',{exact:true}).waitFor();
  await page.reload();
  if(await page.getByRole('combobox',{name:'Активность'}).inputValue()!=='active')throw Error('Settings did not persist');
  await page.getByRole('button',{name:'Разговор',exact:true}).click();
  await page.getByRole('textbox',{name:'Сообщение'}).fill('Привет');
  await page.getByRole('button',{name:'Отправить'}).click();
  await page.locator('.message.assistant').waitFor();
  await page.getByRole('textbox',{name:'Сообщение'}).fill('Запомни: люблю игры');
  await page.getByRole('button',{name:'Отправить'}).click();
  await page.getByRole('button',{name:'Память',exact:true}).click();
  await page.getByRole('textbox',{name:'Факт 1',exact:true}).waitFor();
  if(await page.getByRole('textbox',{name:'Факт 1',exact:true}).inputValue()!=='люблю игры')throw Error('Memory did not persist');
  await page.getByRole('button',{name:'Удалить факт 1',exact:true}).click();
  await page.getByRole('button',{name:'Доступ',exact:true}).click();
  await page.screenshot({path:path.join(__dirname,'privacy.png')});
  await page.setViewportSize({width:550,height:440});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Horizontal overflow');
  await page.screenshot({path:path.join(__dirname,'compact.png')});
  await page.goto('http://127.0.0.1:1421/');
  await page.locator('canvas').waitFor();await page.waitForTimeout(1400);
  await page.screenshot({path:path.join(__dirname,'pet.png'),omitBackground:true});
  if(errors.length)throw Error(errors.join('\n'));
  fs.writeFileSync(path.join(__dirname,'ui-result.json'),JSON.stringify({ok:true,errors,checks:['settings save + reload','local conversation','explicit memory add + delete','minimum window layout','sprite scene boot']},null,2));
  console.log('UI checks passed');
 }catch(e){await page.screenshot({path:path.join(__dirname,'ui-error.png')});console.error(e);console.error('BODY',await page.locator('body').innerText());process.exitCode=1;}
 finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
