import os from 'node:os'
import path from 'node:path'
import { shareBrowseSchema, shareOptionsSchema, type ShareOptions, type ShareStatus } from '../../../../packages/contracts/sharing'
import type { Entry } from '../../../../packages/contracts'
import { WorkerClient } from './worker'
import type { MediaService } from './media'

export function shareInterfaces(){
  const items:{name:string;address:string;loopback:boolean}[]=[]
  for(const [name,addresses]of Object.entries(os.networkInterfaces()))for(const item of addresses??[])if(item.family==='IPv4'&&(/^(10\.|192\.168\.|127\.)/.test(item.address)||/^172\.(1[6-9]|2\d|3[01])\./.test(item.address)))items.push({name,address:item.address,loopback:item.internal})
  if(!items.some(v=>v.address==='127.0.0.1'))items.push({name:'仅本机',address:'127.0.0.1',loopback:true})
  return items.sort((a,b)=>Number(a.loopback)-Number(b.loopback)||a.name.localeCompare(b.name))
}
export class LanSharing {
  private worker:WorkerClient|null=null
  private queries:WorkerClient|null=null
  private options:ShareOptions|null=null
  private leases=new Set<string>()
  private error='';private busy=false
  constructor(private here:string,private databaseFile:string,private db:WorkerClient,private media:MediaService,private libraryId:string,private persist:(options:ShareOptions)=>Promise<unknown>,private changed:()=>void){}
  get keepInTray(){return !!this.worker&&!!this.options?.keepInTray}
  private empty():ShareStatus{return {running:false,url:'',connectionUrl:'',qr:'',qrExpires:0,options:null,devices:[],error:this.error,interfaces:shareInterfaces()}}
  async status():Promise<ShareStatus>{if(!this.worker)return this.empty();try{const state=await this.worker.call('status');return state?{...state,interfaces:shareInterfaces()}:this.empty()}catch{this.error='共享服务退出，请重新开启';this.dispose();return this.empty()}}
  async start(input:ShareOptions){
    if(this.busy||this.worker)throw Error('请先停止当前共享，再更改共享设置')
    const options=shareOptionsSchema.parse(input)
    if(!shareInterfaces().some(v=>v.address===options.host))throw Error('请选择当前电脑的有效网络地址')
    this.busy=true
    try{for(const id of options.folderIds){const entry=await this.db.call<Entry>('entry',id);if(entry.kind!=='folder'||entry.state!=='present')throw Error('请选择有效的资源文件夹');await this.db.call('sharedEntry',options.folderIds,id)}}catch(error){this.busy=false;throw error}
    this.options=options;this.error=''
    const worker=new WorkerClient(path.join(this.here,'sharing.cjs'),'局域网共享');this.worker=worker
    worker.process.on('message',message=>{if(message.rpc)void this.rpc(worker,message)})
    worker.process.on('exit',()=>{if(this.worker===worker){this.error='共享服务意外退出，请重新开启';this.dispose();this.changed()}})
    try{
      this.queries=new WorkerClient(path.join(this.here,'database.cjs'),'共享只读查询')
      await this.queries.call('init',this.databaseFile,true)
      await worker.call('start',path.join(this.here,'sharing-web'),options,this.libraryId)
      await this.persist(options);this.changed();return await this.status()
    }catch(error){this.dispose();this.error=String(error).includes('EADDRINUSE')?'端口已被占用，请换一个端口':String(error).includes('EACCES')?'当前地址或端口无法监听，请选择其他端口或检查网络权限':error instanceof Error?error.message:String(error);throw Error(this.error)}finally{this.busy=false}
  }
  private async rpc(worker:WorkerClient,message:{rpc:number;method:string;args:any[]}){
    const reply=(value:Record<string,unknown>)=>{if(this.worker===worker)worker.process.postMessage({rpc:message.rpc,...value})}
    try{
      const options=this.options;if(this.worker!==worker||!options)throw Error('SHARE_NOT_FOUND')
      const [id,purpose]=message.args
      let result:unknown
      if(message.method==='browse'){if(!this.queries)throw Error('SHARE_NOT_FOUND');result=await this.queries.call('sharedBrowse',options.folderIds,shareBrowseSchema.parse(id))}
      else if(message.method==='release'){if(this.leases.delete(id))this.media.release(id);result=null}
      else if(message.method==='file'||message.method==='activity'){
        if(typeof id!=='string'||id.length>200)throw Error('SHARE_NOT_FOUND')
        const entry=await this.db.call<Entry>('sharedEntry',options.folderIds,id)
        if(message.method==='activity')result={name:entry.name,kind:entry.kind}
        else{
          if(!['original','thumbnail'].includes(purpose)||purpose==='original'&&entry.kind==='folder')throw Error('SHARE_NOT_FOUND')
          const lease=await this.media.media(id,purpose,false)
          if(this.worker!==worker){this.media.release(lease);return}
          try{await this.db.call('sharedEntry',options.folderIds,id)}catch(error){this.media.release(lease);throw error}
          if(this.worker!==worker){this.media.release(lease);return}
          const source=this.media.resolve(new URL(lease).pathname.slice(1));this.leases.add(lease)
          result={path:source.path,mime:source.mime,identity:source.identity,lease}
        }
      }else throw Error('SHARE_NOT_FOUND')
      reply({result})
    }catch(error){reply({error:error instanceof Error?error.message:String(error)})}
  }
  async revoke(id:string){await this.worker?.call('revoke',id);this.changed();return this.status()}
  async renew(){await this.worker?.call('renew');this.changed();return this.status()}
  async stop(){if(this.busy)throw Error('共享服务正在启动，请稍后重试');const worker=this.worker;try{await worker?.call('stop')}finally{this.dispose();this.error='';this.changed()}return this.empty()}
  dispose(){const worker=this.worker;this.worker=null;this.options=null;for(const lease of this.leases)this.media.release(lease);this.leases.clear();worker?.close();this.queries?.close();this.queries=null}
}
