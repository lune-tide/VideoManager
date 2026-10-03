import { describe,it,expect,beforeEach,afterEach,vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { request } from 'node:http'
import { ShareServer, type ShareBackend } from '../packages/sharing/server'
let server:ShareServer,url:string,invitation:string,cookie:string
const base=path.resolve('.test-data/sharing-unit')
let releases=0
const backend:ShareBackend={browse:async()=>({entries:[],total:0,breadcrumbs:[]}),file:async(id)=>{if(id!=='allowed')throw Error('SHARE_NOT_FOUND');return {path:path.join(base,'video.mp4'),mime:'video/mp4',identity:null,lease:'lease'}},release:async()=>{releases++},activity:async id=>{if(id!=='allowed')throw Error('SHARE_NOT_FOUND');return {name:'测试视频',kind:'video'}}}
const get=(endpoint:string,headers:Record<string,string>={})=>fetch(url+endpoint,{headers:{Cookie:cookie,...headers}})
async function pair(qrInvitation=invitation,name='测试手机'){return fetch(url+'/api/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitation:qrInvitation,name})})}
beforeEach(async()=>{await fs.mkdir(base,{recursive:true});await fs.writeFile(path.join(base,'video.mp4'),Buffer.from(Array.from({length:256},(_,i)=>i)));releases=0;cookie='';server=new ShareServer(path.resolve('apps/desktop/src/sharing-web'),backend,{host:'127.0.0.1',port:0,folderIds:['allowed'],maxDevices:2,keepInTray:false},'library');const status=await server.start();url=status.url;invitation=new URLSearchParams(new URL(status.connectionUrl).hash.slice(1)).get('connect')!})
afterEach(async()=>{vi.restoreAllMocks();await server.stop()})
async function authorize(){const response=await pair();expect(response.status).toBe(200);cookie=response.headers.get('set-cookie')!.split(';')[0]!;return response.json()}
describe('局域网只读 HTTP 服务',()=>{
 it('入口可访问，所有资源接口需授权，静态资源白名单阻止路径读取',async()=>{expect((await get('/')).status).toBe(200);expect((await get('/api/browse')).status).toBe(401);expect((await get('/package.json')).status).toBe(404);expect((await get('/app.js')).headers.get('content-security-policy')).toContain("script-src 'self'");expect(server.status().qr).toContain('data:image/svg+xml')})
 it('二维码凭证验证、HttpOnly Cookie 与返回字段',async()=>{expect((await pair('000')).status).toBe(403);const response=await pair();expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');cookie=response.headers.get('set-cookie')!.split(';')[0]!;const body=await response.json();expect(body).not.toHaveProperty('code');expect((await get('/api/session')).status).toBe(200)})
 it('256 位二维码凭证只通过 POST 交换，公开页面和普通地址不授予权限',async()=>{
   expect(invitation).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(Buffer.from(invitation,'base64url')).toHaveLength(32)
   expect(server.status()).not.toHaveProperty('code');expect(server.status().connectionUrl).toBe(url+'/#connect='+invitation)
   const page=await (await get('/?connect='+invitation)).text();expect(page).not.toContain(invitation);expect(page).not.toContain('id="code"')
   expect((await get('/api/browse?connect='+invitation)).status).toBe(401)
   expect((await get('/api/connect?invitation='+invitation)).status).toBe(401)
   expect((await fetch(url+'/api/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'12345678'})})).status).toBe(403)
   expect((await fetch(url+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'12345678'})})).status).toBe(401)
 })
 it('已授权设备重复扫码复用会话，不消耗设备名额',async()=>{
   const first=await authorize();expect((await pair(invitation,'第二台')).status).toBe(200)
   const again=await fetch(url+'/api/connect',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({invitation,name:'重复扫码'})})
   expect(again.status).toBe(200);expect((await again.json()).deviceId).toBe(first.deviceId);expect(again.headers.get('set-cookie')).toBeNull();expect(server.status().devices).toHaveLength(2)
   expect((await pair(invitation,'第三台')).status).toBe(409)
 })
 it('撤销设备同时轮换二维码，旧扫码链接不能重新授权，其他设备继续访问',async()=>{
   const first=await authorize();const second=await pair(invitation,'第二台');const otherCookie=second.headers.get('set-cookie')!.split(';')[0]!
   const previous=server.status();server.revoke(first.deviceId);const current=server.status()
   expect(current.connectionUrl).not.toBe(previous.connectionUrl);expect(current.qr).not.toBe(previous.qr);expect((await pair()).status).toBe(403)
   expect((await get('/api/session')).status).toBe(401);expect((await get('/api/session',{Cookie:otherCookie})).status).toBe(200)
   invitation=new URLSearchParams(new URL(current.connectionUrl).hash.slice(1)).get('connect')!;expect((await pair()).status).toBe(200)
 })
 it('慢请求在提交完成时检查二维码到期，防止提前打开请求延长授权',async()=>{
   const expires=server.status().qrExpires
   const response=new Promise<number>((resolve,reject)=>{
     const req=request(url+'/api/connect',{method:'POST',headers:{'Content-Type':'application/json'}},res=>{res.resume();resolve(res.statusCode!)})
     req.on('error',reject);req.write('{"invitation":');vi.spyOn(Date,'now').mockReturnValue(expires);req.end(JSON.stringify(invitation)+'}')
   })
   expect(await response).toBe(403);expect(server.status().devices).toHaveLength(0)
 })
 it('完整响应、Range、后缀、HEAD 和错误范围',async()=>{await authorize();let response=await get('/api/media/allowed/original',{Range:'bytes=64-127'});expect(response.status).toBe(206);expect(response.headers.get('content-range')).toBe('bytes 64-127/256');expect(new Uint8Array(await response.arrayBuffer())[0]).toBe(64);response=await get('/api/media/allowed/original',{Range:'bytes=-16'});expect((await response.arrayBuffer()).byteLength).toBe(16);response=await fetch(url+'/api/media/allowed/original',{method:'HEAD',headers:{Cookie:cookie}});expect(response.headers.get('content-length')).toBe('256');expect((await response.arrayBuffer()).byteLength).toBe(0);response=await get('/api/media/allowed/original',{Range:'bytes=256-'});expect(response.status).toBe(416);response=await get('/api/media/allowed/original');expect((await response.arrayBuffer()).byteLength).toBe(256);expect(releases).toBeGreaterThan(0)})
 it('未共享资源、写接口、非法查询与跨站请求被拒绝',async()=>{await authorize();expect((await get('/api/media/private/original')).status).toBe(404);expect((await get('/api/browse?limit=1000')).status).toBe(400);expect((await get('/api/browse',{Origin:'https://evil.example'})).status).toBe(403);expect((await fetch(url+'/api/delete',{method:'DELETE',headers:{Cookie:cookie}})).status).toBe(405);expect((await fetch(url+'/api/rename',{method:'POST',headers:{Cookie:cookie}})).status).toBe(404)})
 it('拒绝伪造 Host，防止 DNS 重绑定',async()=>{const status=await new Promise<number>(resolve=>{const req=request(url,{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode!)});req.end()});expect(status).toBe(403)})
 it('刷新二维码不影响已授权设备，撤销后拒绝新请求',async()=>{const device=await authorize();const old=invitation;server.renewQr();if(server.status().connectionUrl!==url+'/#connect='+old)expect((await pair(old)).status).toBe(403);expect((await get('/api/session')).status).toBe(200);server.revoke(device.deviceId);expect((await get('/api/session')).status).toBe(401);expect(server.status().devices).toHaveLength(0)})
 it('设备上限与退出释放授权',async()=>{await authorize();expect((await pair(invitation,'第二台')).status).toBe(200);expect((await pair(invitation,'第三台')).status).toBe(409);expect((await fetch(url+'/api/logout',{method:'POST',headers:{Cookie:cookie}})).status).toBe(200);expect((await get('/api/session')).status).toBe(401);expect((await pair(invitation,'新设备')).status).toBe(200)})
 it('扫码连接失败限速',async()=>{for(let i=0;i<6;i++)expect((await pair('invalid!')).status).toBe(403);expect((await pair()).status).toBe(429)})
 it('二维码和设备会话分别按到期时间失效',async()=>{await authorize();const now=Date.now();const spy=vi.spyOn(Date,'now').mockReturnValue(now+11*60*1000);expect((await pair()).status).toBe(403);expect((await get('/api/session')).status).toBe(200);spy.mockReturnValue(now+25*60*60*1000);expect((await get('/api/session')).status).toBe(401)})
 it('撤销授权中断尚未读取完的视频，并释放媒体租约',async()=>{
   await server.stop();const file=await fs.open(path.join(base,'large.mp4'),'w');await file.truncate(32*1024*1024);await file.close()
   server=new ShareServer(path.resolve('apps/desktop/src/sharing-web'),{...backend,file:async()=>({path:path.join(base,'large.mp4'),mime:'video/mp4',identity:null,lease:'large'})},{host:'127.0.0.1',port:0,folderIds:['allowed'],maxDevices:2,keepInTray:false},'library');const status=await server.start();url=status.url;invitation=new URLSearchParams(new URL(status.connectionUrl).hash.slice(1)).get('connect')!;const device=await authorize()
   const response=await new Promise<import('node:http').IncomingMessage>((resolve,reject)=>{const req=request(url+'/api/media/allowed/original',{headers:{Cookie:cookie}},res=>{res.pause();resolve(res)});req.on('error',reject);req.end()})
   expect(response.complete).toBe(false);expect(server.status().devices[0]?.streams).toBeGreaterThan(0)
   const closed=new Promise<void>(resolve=>{response.on('error',()=>{});response.once('close',resolve)});server.revoke(device.deviceId);response.resume();await closed;expect(response.complete).toBe(false)
   await vi.waitFor(()=>expect(releases).toBeGreaterThan(0));expect((await get('/api/session')).status).toBe(401)
 })
 it('活动状态更新及停止后旧会话失效',async()=>{await authorize();expect((await fetch(url+'/api/playing',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({entryId:'allowed'})})).status).toBe(200);expect(server.status().devices[0]?.playing).toBe('测试视频');await server.stop();const next=await server.start();url=next.url;expect((await get('/api/session')).status).toBe(401)})
})
