import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto'
import qrcode from 'qrcode-generator'
import { parseRange } from '../domain'
import { shareBrowseSchema, type ShareBrowse, type ShareDevice, type ShareOptions, type SharedPage } from '../contracts/sharing'

export type ShareFile = { path: string; mime: string; identity: string | null; lease: string }
export type ShareBackend = {
  browse(input: ShareBrowse): Promise<SharedPage>
  file(id: string, purpose: 'thumbnail' | 'original'): Promise<ShareFile>
  release(lease: string): Promise<void>
  activity(id: string): Promise<{ name: string; kind: string }>
}
type Device = ShareDevice & { responses: Set<ServerResponse> }
class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }
const cookieName='vm_lan_session'
const hash=(text:string)=>createHash('sha256').update(text).digest('hex')
const csp="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

/** A read-only network service. The backend validates the directory grant on every request. */
export class ShareServer {
  private server: Server | null=null
  private sessions=new Map<string,Device>()
  private attempts=new Map<string,{count:number;until:number}>()
  private allAttempts={count:0,until:0}
  private invitationHash='';private qrExpires=0;private connectionUrl='';private qr='';private url='';private timer:ReturnType<typeof setInterval>|null=null
  private activeFiles=0;private activeQueries=0;private generation=0
  constructor(private assets: string, private backend: ShareBackend, private options: ShareOptions, private libraryKey: string) {}
  async start() {
    if(this.server)throw Error('共享服务已开启')
    const server=createServer((req,res)=>{void this.handle(req,res)})
    server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=64;server.maxConnections=128
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(this.options.port,this.options.host,()=>{server.removeListener('error',reject);resolve()})})
    this.server=server;this.generation++;const address=server.address();const port=typeof address==='object'&&address?address.port:this.options.port
    this.url=`http://${this.options.host}:${port}`
    this.renewQr();this.timer=setInterval(()=>this.expireSessions(),30000);this.timer.unref()
    return this.status()
  }
  status(){this.expireSessions();return {running:!!this.server,url:this.url,connectionUrl:this.connectionUrl,qr:this.qr,qrExpires:this.qrExpires,options:this.options,devices:[...this.sessions.values()].map(({responses,...device})=>({...device,streams:responses.size})),error:''}}
  renewQr(){
    if(!this.server)throw Error('请先开启共享')
    const invitation=randomBytes(32).toString('base64url')
    this.invitationHash=hash(invitation);this.qrExpires=Date.now()+10*60*1000
    // The fragment stays out of page/resource URLs; the browser exchanges it in a POST body.
    this.connectionUrl=this.url+'/#connect='+invitation
    const qr=qrcode(0,'M');qr.addData(this.connectionUrl);qr.make();this.qr='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr.createSvgTag({cellSize:4,margin:16,scalable:true}))
    return this.status()
  }
  private drop(device:Device,except?:ServerResponse){for(const [key,value]of this.sessions)if(value===device)this.sessions.delete(key);for(const response of device.responses)if(response!==except)response.destroy()}
  revoke(id:string){let revoked=false;for(const device of this.sessions.values())if(device.id===id){this.drop(device);revoked=true}if(revoked)this.renewQr();return this.status()}
  private expireSessions(){for(const device of this.sessions.values())if(device.expires<=Date.now())this.drop(device);for(const [key,value]of this.attempts)if(value.until<=Date.now())this.attempts.delete(key)}
  async stop(){this.generation++;if(this.timer)clearInterval(this.timer);this.timer=null;for(const device of this.sessions.values())this.drop(device);const server=this.server;this.server=null;this.invitationHash='';this.qrExpires=0;this.connectionUrl='';this.url='';this.qr='';this.attempts.clear();this.allAttempts={count:0,until:0};if(server){const closed=new Promise<void>(resolve=>server.close(()=>resolve()));server.closeAllConnections();await closed}}
  private json(res:ServerResponse,status:number,body:unknown){if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}
  private async body(req:IncomingMessage):Promise<Record<string,unknown>>{
    if(req.headers['content-type']?.split(';')[0]!=='application/json')throw new HttpError(415,'请使用 JSON 请求')
    let length=0;const parts:Buffer[]=[]
    for await(const chunk of req){length+=chunk.length;if(length>2048)throw new HttpError(413,'请求过大');parts.push(Buffer.from(chunk))}
    try{const value=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value}catch{throw new HttpError(400,'请求格式无效')}
  }
  private authenticate(req:IncomingMessage){
    const cookie=req.headers.cookie?.split(';').find(v=>v.trim().startsWith(cookieName+'='))?.trim().slice(cookieName.length+1)
    const device=cookie?this.sessions.get(hash(cookie)):undefined
    if(!device||device.expires<=Date.now()){if(device)this.drop(device);throw new HttpError(401,'请扫描电脑端二维码连接此设备')}
    device.lastSeen=Date.now();return device
  }
  private async connect(req:IncomingMessage,res:ServerResponse){
    const generation=this.generation
    const address=req.socket.remoteAddress??'';const now=Date.now()
    if(this.allAttempts.until<=now)this.allAttempts={count:0,until:now+60000}
    let attempt=this.attempts.get(address);if(!attempt||attempt.until<=now){if(this.attempts.size>=1024)throw new HttpError(429,'连接请求过多，请稍后重试');attempt={count:0,until:now+60000};this.attempts.set(address,attempt)}
    if(++attempt.count>6||++this.allAttempts.count>30){res.setHeader('Retry-After','60');throw new HttpError(429,'连接尝试过多，请一分钟后重试')}
    const body=await this.body(req);const invitation=typeof body.invitation==='string'?body.invitation:''
    if(!this.server||generation!==this.generation)throw new HttpError(503,'共享已停止，请重新扫码')
    if(!/^[A-Za-z0-9_-]{43}$/.test(invitation)||this.qrExpires<=Date.now()||!timingSafeEqual(Buffer.from(hash(invitation)),Buffer.from(this.invitationHash)))throw new HttpError(403,'二维码无效或已过期，请在电脑端刷新二维码后重新扫描')
    // Rescanning from an already authorized browser must not consume another device slot.
    try{const device=this.authenticate(req);this.json(res,200,{name:device.name,deviceId:device.id,libraryKey:this.libraryKey,expires:device.expires});return}catch(error){if(!(error instanceof HttpError)||error.status!==401)throw error}
    this.expireSessions();if(this.sessions.size>=this.options.maxDevices)throw new HttpError(409,'已达到设备数量上限，请在电脑端撤销旧设备')
    const connectedAt=Date.now()
    const token=randomBytes(32).toString('base64url');const device:Device={id:randomUUID(),name:typeof body.name==='string'?body.name.replace(/[\x00-\x1f]/g,'').trim().slice(0,48)||'浏览器设备':'浏览器设备',address,connectedAt,lastSeen:connectedAt,expires:connectedAt+24*60*60*1000,playing:'',streams:0,responses:new Set()}
    this.sessions.set(hash(token),device);res.setHeader('Set-Cookie',`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`)
    this.json(res,200,{name:device.name,deviceId:device.id,libraryKey:this.libraryKey,expires:device.expires})
  }
  private async staticFile(req:IncomingMessage,res:ServerResponse,name:string){
    const mapping:Record<string,[string,string]>={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/app.css':['app.css','text/css; charset=utf-8']}
    const asset=mapping[name];if(!asset)throw new HttpError(404,'页面不存在')
    const bytes=await fs.readFile(path.join(this.assets,asset[0]));res.writeHead(200,{'Content-Type':asset[1],'Content-Length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes)
  }
  private async stream(req:IncomingMessage,res:ServerResponse,device:Device,id:string,purpose:'thumbnail'|'original'){
    if(this.activeFiles>=24||device.responses.size>12)throw new HttpError(503,'当前播放连接较多，请稍后重试')
    this.activeFiles++;let file:ShareFile|undefined;let handle:fs.FileHandle|undefined
    const generation=this.generation
    try{
      file=await this.backend.file(id,purpose)
      if(res.destroyed||generation!==this.generation||![...this.sessions.values()].includes(device))return
      handle=await fs.open(file.path,'r');const stat=await handle.stat({bigint:true})
      if(!stat.isFile())throw Error('SHARE_NOT_FOUND')
      if(file.identity){const [dev,ino]=file.identity.split(':');if(stat.dev.toString()!==dev||stat.ino.toString()!==ino)throw Error('SOURCE_CHANGED')}
      const size=Number(stat.size);if(!Number.isSafeInteger(size))throw new HttpError(413,'资源过大')
      const range=parseRange(req.headers.range??null,size)
      const headers:Record<string,string>={'Content-Type':file.mime,'Accept-Ranges':'bytes'}
      if(!range){res.writeHead(416,{...headers,'Content-Range':`bytes */${size}`});res.end();return}
      headers['Content-Length']=String(size===0?0:range.end-range.start+1)
      if(range.partial)headers['Content-Range']=`bytes ${range.start}-${range.end}/${size}`
      res.writeHead(range.partial?206:200,headers)
      if(req.method==='HEAD'||size===0){res.end();return}
      const source=handle.createReadStream({start:range.start,end:range.end,autoClose:true});handle=undefined
      await new Promise<void>((resolve,reject)=>{res.once('close',()=>source.destroy());source.once('error',reject);source.once('close',resolve);source.pipe(res)})
    }finally{await handle?.close().catch(()=>{});if(file)await this.backend.release(file.lease).catch(()=>{});this.activeFiles--}
  }
  private async handle(req:IncomingMessage,res:ServerResponse){
    for(const [name,value]of Object.entries({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':csp,'Cross-Origin-Resource-Policy':'same-origin'}))res.setHeader(name,value)
    try{
      if(!this.server)throw new HttpError(503,'共享已停止')
      const base=new URL(this.url)
      if(req.headers.host!==base.host)throw new HttpError(403,'访问地址无效，请使用电脑端显示的地址')
      if(req.headers.origin&&req.headers.origin!==base.origin)throw new HttpError(403,'不允许跨站访问')
      if(req.headers['sec-fetch-site']==='cross-site'&&req.headers['sec-fetch-mode']!=='navigate')throw new HttpError(403,'不允许跨站访问')
      if(!['GET','HEAD','POST'].includes(req.method??''))throw new HttpError(405,'此共享只允许浏览和播放')
      const url=new URL(req.url??'/',base)
      if(!url.pathname.startsWith('/api/')){if(!['GET','HEAD'].includes(req.method??''))throw new HttpError(405,'请求方法无效');await this.staticFile(req,res,url.pathname);return}
      if(url.pathname==='/api/connect'&&req.method==='POST'){await this.connect(req,res);return}
      const device=this.authenticate(req);device.responses.add(res);res.once('close',()=>device.responses.delete(res))
      if(url.pathname==='/api/session'&&req.method==='GET'){this.json(res,200,{name:device.name,deviceId:device.id,libraryKey:this.libraryKey,expires:device.expires});return}
      if(url.pathname==='/api/logout'&&req.method==='POST'){res.setHeader('Set-Cookie',`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);this.json(res,200,{ok:true});this.drop(device,res);return}
      if(url.pathname==='/api/playing'&&req.method==='POST'){const body=await this.body(req);if(body.entryId===null){device.playing='';this.json(res,200,{ok:true});return}if(typeof body.entryId!=='string'||body.entryId.length>200)throw new HttpError(400,'资源无效');const info=await this.backend.activity(body.entryId);if(res.destroyed)return;device.playing=info.kind==='video'?info.name:'';this.json(res,200,{ok:true});return}
      if(url.pathname==='/api/browse'&&req.method==='GET'){
        if(this.activeQueries>=8)throw new HttpError(503,'正在加载其他目录，请稍后重试')
        const input=shareBrowseSchema.safeParse({folderId:url.searchParams.get('folderId'),text:url.searchParams.get('text')??'',kind:url.searchParams.get('kind')??'',offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??60)})
        if(!input.success)throw new HttpError(400,'查询条件无效')
        this.activeQueries++;try{const result=await this.backend.browse(input.data);this.json(res,200,result)}finally{this.activeQueries--}return
      }
      const match=url.pathname.match(/^\/api\/media\/([^/]+)\/(thumbnail|original)$/)
      if(match&&['GET','HEAD'].includes(req.method??'')){const id=decodeURIComponent(match[1]!);if(id.length>200)throw new HttpError(400,'资源无效');await this.stream(req,res,device,id,match[2] as 'thumbnail'|'original');return}
      throw new HttpError(404,'接口不存在')
    }catch(error){
      if(res.destroyed)return
      if(res.headersSent){res.destroy();return}
      if(error instanceof HttpError){this.json(res,error.status,{error:error.message});return}
      const unavailable=String(error).includes('SHARE_NOT_FOUND')
      this.json(res,unavailable?404:503,{error:unavailable?'资源不存在或未共享':'资源暂不可用，目录可能离线或文件已变化，请刷新后重试'})
    }
  }
}
