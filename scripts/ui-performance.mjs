import {_electron as electron} from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const label=process.env.VM_UI_LABEL||'optimized'
const executable=process.env.VM_TEST_EXECUTABLE
const directory=path.resolve('.test-data/ui-performance-'+label+'-'+Date.now())
await fs.mkdir('test-results',{recursive:true})
const application=await electron.launch({executablePath:path.resolve(executable||'node_modules/electron/dist/electron.exe'),args:executable?[]:['.'],env:{...process.env,VM_DATA_DIR:directory,VM_TEST_HIDDEN:'1'}})
application.process().stderr.on('data',data=>console.log(String(data).trim()))
const errors=[],report={label,date:new Date().toISOString(),scope:'同机生产构建、隔离的 44 项媒体样本；暖机打开 3 次。主线程指标不包含 GPU 时间，不代表所有编码或大型媒体库。'}
try{
 const page=await application.firstWindow()
 page.on('pageerror',error=>errors.push(error.message))
 await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive())
 await page.getByRole('button',{name:'添加第一个资源目录',exact:true}).waitFor()
 await page.evaluate(()=>window.vm.settings({theme:'dark'}))
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark')
 await page.screenshot({path:'test-results/ui-'+label+'-welcome.png'})
 await application.evaluate(({dialog},source)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]})},path.resolve('.test-data/fixtures'))
 const picked=await page.evaluate(()=>window.vm.pickRoot())
 await page.evaluate(grant=>window.vm.addRoot(grant),picked.grant)
 await page.waitForFunction(async()=>{const data=await window.vm.bootstrap();return data.roots[0]?.state==='online'},{},{timeout:60000})
 await page.getByRole('button',{name:'全部媒体',exact:true}).click()
 await page.locator('.viewport [role=option]').first().waitFor()
 await page.waitForFunction(()=>document.querySelectorAll('.viewport .thumbnail img').length>8)
 for(let i=0;i<12;i++)await page.locator('.viewport [role=option]').nth(i).click({modifiers:['Control']})
 await page.waitForFunction(()=>document.querySelectorAll('.viewport [aria-selected=true]').length>8)
 await page.waitForTimeout(500)
 const cdp=await page.context().newCDPSession(page)
 await cdp.send('Performance.enable')
 const measure=async()=>{
  const before=(await cdp.send('Performance.getMetrics')).metrics
  await page.waitForTimeout(2000)
  const after=(await cdp.send('Performance.getMetrics')).metrics
  const delta=name=>Math.round(((after.find(m=>m.name===name)?.value??0)-(before.find(m=>m.name===name)?.value??0))*1000*100)/100
  return {taskMs:delta('TaskDuration'),styleMs:delta('RecalcStyleDuration'),layoutMs:delta('LayoutDuration'),runningAnimations:await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)}
 }
 report.selectedGrid=await measure()
 await page.screenshot({path:'test-results/ui-'+label+'-browse.png'})
 await page.getByRole('button',{name:'取消选择 (Esc)',exact:true}).click()
 await page.locator('.search-box input').fill('色彩与节奏')
 const video=page.locator('.viewport [role=option][aria-label="色彩与节奏.mp4"]')
 report.chromiumOpenMs=[]
 for(let i=0;i<3;i++){
  const start=performance.now()
  await video.dblclick()
  await page.waitForFunction(()=>{const v=document.querySelector('.viewer-stage video');return v&&v.readyState>=1})
  report.chromiumOpenMs.push(Math.round(performance.now()-start))
  await page.locator('.modal').getByRole('button',{name:'关闭',exact:true}).click()
 }
 await page.evaluate(()=>window.vm.setPlugin('builtin.viewer-mpv',true,{}))
 await page.waitForTimeout(350)
 await page.evaluate(()=>{
  window.surfaceReads=0
  window.mpvState=null
  window.vm.onEvent(event=>{if(event.topic==='mpv-state')window.mpvState=event.data})
  const original=HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect=function(){if(this.classList.contains('mpv-surface'))window.surfaceReads++;return original.call(this)}
 })
 const start=performance.now()
 await video.dblclick()
 await page.locator('.mpv-tools button[aria-label="暂停"]:enabled').waitFor({timeout:30000})
 report.mpvOpenMs=Math.round(performance.now()-start)
 await page.waitForTimeout(500)
 await page.evaluate(()=>{window.surfaceReads=0})
 report.mpvIdle=await measure()
 report.mpvIdle.surfaceBoundsReads=await page.evaluate(()=>window.surfaceReads)
 if(label!=='baseline')assert(report.mpvIdle.surfaceBoundsReads<=2,'Unexpected idle bounds polling')
 const playing=await page.evaluate(()=>window.mpvState)
 assert(playing.position>0,'mpv decoded playback must advance')
 await page.evaluate(async state=>{if(!state.paused)await window.vm.mpvControl(state.sessionId,'toggle-pause');await window.vm.mpvControl(state.sessionId,'seek',1);await window.vm.mpvControl(state.sessionId,'speed',1.5);await window.vm.mpvControl(state.sessionId,'volume',65)},playing)
 await page.waitForFunction(()=>window.mpvState?.paused&&window.mpvState?.speed===1.5&&window.mpvState?.volume===65&&Math.abs(window.mpvState?.position-1)<.2)
 await page.evaluate(()=>{window.surfaceReads=0})
 await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,720))
 await page.waitForTimeout(400)
 const bounds=await page.evaluate(()=>{const r=document.querySelector('.mpv-surface').getBoundingClientRect();return {width:r.width,height:r.height}})
 assert(bounds.width>0&&bounds.height>0)
 assert(await page.evaluate(()=>window.surfaceReads)>0,'Window resize must update native bounds')
 await page.screenshot({path:'test-results/ui-'+label+'-player.png'})
 await page.getByRole('button',{name:'全屏',exact:true}).click()
 await page.waitForFunction(()=>!!document.fullscreenElement)
 assert.equal(await page.locator('.mpv-controls-panel').isVisible(),false)
 await page.waitForTimeout(250)
 await page.evaluate(()=>document.exitFullscreen())
 await page.waitForFunction(()=>!document.fullscreenElement)
 await page.locator('.modal').getByRole('button',{name:'关闭',exact:true}).click()
 await assert.rejects(page.evaluate(id=>window.vm.mpvControl(id,'seek',1),playing.sessionId))
 // Viewer cleanup submits close asynchronously; wait for the persisted position, not only the closed session event.
 await page.waitForFunction(async id=>{const saved=await window.vm.entry(id);return saved.playback>=.8&&saved.playback<=1.2},playing.entryId,{timeout:10000})
 const saved=await page.evaluate(id=>window.vm.entry(id),playing.entryId)
 assert(saved.playback>=.8&&saved.playback<=1.2)
 report.mpvControls={seek:true,pause:true,speed:true,volume:true,resize:true,fullscreen:true,close:true,resumePosition:saved.playback}
 report.errors=errors
 assert.deepEqual(errors,[])
 console.log(JSON.stringify(report,null,2))
}finally{
 await application.close()
 await fs.writeFile('test-results/ui-performance-'+label+'.json',JSON.stringify(report,null,2))
}
