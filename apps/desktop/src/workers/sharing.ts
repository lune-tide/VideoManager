import { ShareServer, type ShareBackend } from '../../../../packages/sharing/server'
const parent=process.parentPort!
let server:ShareServer|null=null;let counter=0
const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
function rpc(method:string,...args:unknown[]):Promise<any>{const rpc=++counter;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(rpc);reject(Error('共享请求超时'))},30000);pending.set(rpc,{resolve,reject,timer});parent.postMessage({rpc,method,args})})}
const backend:ShareBackend={browse:input=>rpc('browse',input),file:(id,purpose)=>rpc('file',id,purpose),release:lease=>rpc('release',lease),activity:id=>rpc('activity',id)}
parent.on('message',async event=>{
  const message=event.data
  if(message.rpc){const entry=pending.get(message.rpc);if(!entry){if(message.result?.lease)void rpc('release',message.result.lease).catch(()=>{});return}pending.delete(message.rpc);clearTimeout(entry.timer);if(message.error)entry.reject(Error(message.error));else entry.resolve(message.result);return}
  const {id,method,args}=message
  try{
    let result:unknown
    if(method==='start'){if(server)await server.stop();server=new ShareServer(args[0],backend,args[1],args[2]);result=await server.start()}
    else if(method==='stop'){await server?.stop();server=null;result=null}
    else if(method==='status')result=server?.status()??null
    else if(method==='revoke')result=server?.revoke(args[0])??null
    else if(method==='renew')result=server?.renewQr()??null
    else throw Error('未知共享命令')
    parent.postMessage({id,result})
  }catch(error){parent.postMessage({id,error:error instanceof Error?error.message:String(error)})}
})
