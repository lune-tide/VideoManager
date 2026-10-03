import {it} from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {LibraryDatabase} from '../packages/persistence/database'
import {querySchema} from '../packages/contracts'
it('重测已完成的十万条索引，不读取并行构建中的样本',async context=>{
 let db:LibraryDatabase|undefined
 for(const folder of fs.readdirSync('.test-data').filter(n=>n.startsWith('benchmark-')).sort().reverse()){
  let candidate:LibraryDatabase|undefined
  try{const file=path.resolve('.test-data',folder,'library.sqlite');if(!fs.existsSync(file))continue;candidate=new LibraryDatabase(file,true);const count=candidate.db.prepare("SELECT count(*) FROM entries WHERE kind!='folder' AND state='present'").pluck().get() as number;if(count<100000){candidate.close();continue}db=candidate;break}catch{candidate?.close()}
 }
 if(!db){context.skip('没有已完成的十万条索引样本');return}
 try{
  const measure=async(q:unknown)=>{const times:number[]=[];for(let i=0;i<30;i++){const start=performance.now();const s=db!.openQuery(querySchema.parse(q));db!.page(s.id,0,100);times.push(performance.now()-start);await new Promise(r=>setTimeout(r,0))}times.sort((a,b)=>a-b);return {p50Ms:+times[14]!.toFixed(2),p95Ms:+times[28]!.toFixed(2),maxMs:+times.at(-1)!.toFixed(2)}}
  const result={date:new Date().toISOString(),direct:await measure({folderId:'dir-9999',scope:'direct'}),chinese:await measure({folderId:null,scope:'library',text:'西湖'}),selective:await measure({folderId:null,scope:'library',text:'09999'}),all:await measure({folderId:'folder',scope:'descendants',sort:'mtime',direction:'desc'})}
  fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/query-benchmark.json',JSON.stringify(result,null,2));console.log(result)
 }finally{db.close()}
},120000)
