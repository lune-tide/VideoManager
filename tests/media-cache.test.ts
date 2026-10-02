import {it,expect,vi} from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import type {Entry} from '../packages/contracts'
import type {WorkerClient} from '../apps/desktop/src/main/worker'
import type {NativeClient} from '../packages/platform/native'
vi.mock('electron',()=>({dialog:{}}))
import {MediaService} from '../apps/desktop/src/main/media'

it('清缓存等待已有缩略图写入，新请求等待清理完成，手动对象保持',async()=>{
 const directory=path.resolve('.test-data/cache-race-'+randomUUID())
 await fs.mkdir(path.join(directory,'objects'),{recursive:true})
 const object=path.join(directory,'objects','manual.png');await fs.writeFile(object,'preserved cover')
 const entry=(id:string)=>({id,kind:'image',revision:0,coverRevision:0,coverHash:'manual',coverMode:'manual',coverQuality:'balanced'}) as Entry
 let release!:()=>void,started!:()=>void,first=true
 const blocked=new Promise<void>(resolve=>{release=resolve}),writing=new Promise<void>(resolve=>{started=resolve})
 const images={call:async(method:string,_source:string,target:string)=>{expect(method).toBe('thumbnailTo');if(first){first=false;started();await blocked}await fs.writeFile(target,'thumbnail')}} as unknown as WorkerClient
 const db={call:async(_method:string,id:string)=>entry(id)} as unknown as WorkerClient
 const broadcast=vi.fn(),media=new MediaService(directory,'unused',db,images,{} as NativeClient,broadcast)
 try{
  const before=media.media('before','thumbnail');await writing
  const clear=media.clearCache();expect(media.clearCache()).toBe(clear)
  let finished=false;const after=media.media('after','thumbnail').then(value=>{finished=true;return value})
  await new Promise(resolve=>setTimeout(resolve,20));expect(finished).toBe(false)
  release();await before;await clear;await after
  const files=await fs.readdir(path.join(directory,'cache'))
  expect(files).toHaveLength(1);expect(files[0]).toContain('after')
  expect(await fs.readFile(object,'utf8')).toBe('preserved cover');expect(broadcast).toHaveBeenCalledTimes(1)
 }finally{release();media.close()}
})
