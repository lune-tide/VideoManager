import {_electron as electron} from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const executable=process.env.VM_TEST_EXECUTABLE
const data=path.resolve('.test-data/v092-'+Date.now())
const {version}=JSON.parse(await fs.readFile('package.json','utf8'))
let application,page
const results=[],errors=[]
const log=name=>{results.push({name,passed:true});console.log('PASS',name)}
const api=(method,...args)=>page.evaluate(([method,args])=>window.vm[method](...args),[method,args])
async function launch(){
 application=await electron.launch({executablePath:path.resolve(executable||'node_modules/electron/dist/electron.exe'),args:executable?[]:['.'],env:{...process.env,VM_DATA_DIR:data,VM_TEST_HIDDEN:'1'}})
 page=await application.firstWindow();page.on('pageerror',error=>errors.push(error.message))
 await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive())
 await page.getByRole('button',{name:'设置与插件',exact:true}).waitFor()
}
async function settled(){await page.waitForFunction(()=>!document.querySelector('.settings-busy'))}
async function settings(){await page.getByRole('button',{name:'设置与插件',exact:true}).click();await page.getByRole('radio',{name:'自定义主题',exact:true}).waitFor()}
async function capture(name){await page.screenshot({path:'test-results/v092-'+name+'.png'})}
try{
 await fs.mkdir('test-results',{recursive:true});await launch()
 assert.equal((await api('bootstrap')).version,version)
 assert.equal(await page.evaluate(()=>typeof window.require),'undefined')
 await settings()
 await page.getByRole('radio',{name:'自定义主题',exact:true}).click();await settled()
 await page.waitForFunction(async()=>{const b=await window.vm.bootstrap();return b.settings.themePreset==='custom'&&b.settings.accentColor==='#55d6b7'})
 assert.equal(await page.getByRole('radio',{name:'自定义主题',exact:true}).getAttribute('aria-checked'),'true')
 log('首次点击自定义即生效，不依赖历史颜色')
 const text=page.getByRole('textbox',{name:'主题颜色十六进制值'})
 await text.fill('#A63');await page.getByRole('button',{name:'应用颜色',exact:true}).click();await settled()
 await page.waitForFunction(async()=>{const b=await window.vm.bootstrap();return b.settings.accentColor==='#aa6633'})
 await text.fill('#1f9dba');await text.press('Tab')
 assert.equal((await api('bootstrap')).settings.accentColor,'#aa6633')
 await page.getByRole('button',{name:'应用颜色',exact:true}).click();await settled()
 assert.equal((await api('bootstrap')).settings.accentColor,'#1f9dba')
 log('短色值、大小写标准化与一次点击应用；失焦保留草稿')
 await text.fill('#zzzzzz');await text.press('Enter')
 await page.getByRole('alert').filter({hasText:'有效的十六进制颜色'}).waitFor()
 assert.equal(await text.getAttribute('aria-invalid'),'true')
 assert.equal((await api('bootstrap')).settings.accentColor,'#1f9dba')
 await text.fill('#8b5cf6');await text.press('Enter');await settled()
 assert.equal((await api('bootstrap')).settings.accentColor,'#8b5cf6')
 log('无效颜色有可读错误，Enter 保存有效颜色')
 const picker=page.locator('input[type=color]')
 await picker.evaluate(element=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(element,'#d97642');element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}))})
 assert.equal(await text.inputValue(),'#d97642')
 await page.getByRole('button',{name:'应用颜色',exact:true}).click();await settled()
 assert.equal((await api('bootstrap')).settings.accentColor,'#d97642')
 log('颜色选择器与文本草稿同步，明确应用后持久化')
 for(const mode of ['dark','light']){
  await api('settings',{theme:mode})
  await page.waitForFunction(mode=>document.documentElement.dataset.theme===mode,mode)
  for(const name of ['极光','深海','星云','暖阳','樱粉','翠野','石墨']){
   const radio=page.getByRole('radio',{name:name+'主题',exact:true})
   await radio.click();await settled()
   await page.waitForFunction(name=>document.querySelector(`[aria-label="${name}主题"]`)?.getAttribute('aria-checked')==='true',name)
   assert.equal((await api('bootstrap')).settings.accentColor,null)
  }
  await page.getByRole('radio',{name:'极光主题',exact:true}).click();await settled()
  await page.waitForFunction(()=>document.querySelector('[aria-label="极光主题"]')?.getAttribute('aria-checked')==='true')
  await capture('settings-'+mode)
 }
 log('7 种预设在深浅模式下切换，清除自定义颜色')
 await page.getByRole('radio',{name:'极光主题',exact:true}).click();await settled()
 await page.getByRole('radio',{name:'极光主题',exact:true}).focus();await page.keyboard.press('ArrowRight');await settled()
 await page.waitForFunction(async()=>{const b=await window.vm.bootstrap();return b.settings.themePreset==='ocean'})
 log('主题单选组支持方向键')
 await page.getByRole('button',{name:'恢复默认',exact:true}).click();await settled()
 assert.equal((await api('bootstrap')).settings.themePreset,'aurora')
 await page.getByRole('radio',{name:'自定义主题',exact:true}).click();await settled()
 await text.fill('#3355cc');await text.press('Enter');await settled()
 await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1024,720));await page.waitForTimeout(300)
 const overflow=await page.evaluate(()=>{const content=document.querySelector('.settings-content');return content.scrollWidth-content.clientWidth})
 assert(overflow<=1,'settings horizontal overflow: '+overflow)
 await capture('settings-1024')
 log('1024 × 720 设置页无横向溢出')
 await page.locator('.modal').getByRole('button',{name:'关闭',exact:true}).click()
 await page.getByRole('button',{name:'快捷切换主题',exact:true}).click()
 await page.locator('.theme-quick-popover').getByRole('button',{name:'深海主题',exact:true}).click()
 await page.waitForFunction(async()=>{const b=await window.vm.bootstrap();return b.settings.themePreset==='ocean'})
 await page.keyboard.press('Escape')
 log('标题栏主题快捷切换')
 await api('settings',{theme:'system',themePreset:'custom',accentColor:'#3355cc'})
 await page.emulateMedia({colorScheme:'dark'});await page.waitForTimeout(100)
 const dark=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent'))
 await page.emulateMedia({colorScheme:'light'});await page.waitForTimeout(100)
 const light=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent'))
 assert.notEqual(dark,light)
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(300)
 assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0)
 log('跟随系统明暗和减少动态设置')
 await application.close();application=null;await launch();await settings()
 assert.equal((await api('bootstrap')).settings.accentColor,'#3355cc')
 assert.equal(await page.getByRole('textbox',{name:'主题颜色十六进制值'}).inputValue(),'#3355cc')
 log('应用重启保留自定义主题')
 assert.deepEqual(errors,[]);log('无渲染进程异常')
}catch(error){results.push({name:'v0.9.2 regression',passed:false,error:String(error)});console.error(error);if(page)await capture('failure').catch(()=>{});process.exitCode=1}
finally{if(application)await application.close();await fs.writeFile('test-results/v092-regression.json',JSON.stringify({version,date:new Date().toISOString(),results,errors},null,2))}
