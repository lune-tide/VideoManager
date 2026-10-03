import { describe,it,expect,beforeEach,afterEach } from 'vitest'
import { LibraryDatabase } from '../packages/persistence/database'
import { shareBrowseSchema } from '../packages/contracts/sharing'
let db:LibraryDatabase
const item=(id:string,rel:string,kind='image',parentId='root-folder')=>({id,rootId:'root',parentId,kind,name:rel.split('/').pop()!,rel,ext:kind==='folder'?'':'jpg',size:100,mtime:1000,identity:'volume:'+id+':0',seen:'generation'})
beforeEach(()=>{db=new LibraryDatabase(':memory:');db.addRoot({id:'root',name:'不公开的根目录名称',path:'F:\\private',entryId:'root-folder',identity:'v:1'});db.ingest([item('allowed','共享','folder'),item('hidden','隐私','folder')]);db.ingest([item('nested','共享/子目录','folder','allowed'),item('allowed-img','共享/西湖.jpg','image','allowed'),item('private-img','隐私/西湖.jpg','image','hidden')]);db.ingest([item('video','共享/子目录/movie.mp4','video','nested')])})
afterEach(()=>db.close())
const browse=(options:Record<string,unknown>={})=>db.sharedBrowse(['allowed'],shareBrowseSchema.parse(options))
describe('共享目录在 SQL 查询前限制范围',()=>{
 it('首页只显示授予的目录，并清除本机路径和内部元数据',()=>{const result=browse();expect(result.entries.map(e=>e.id)).toEqual(['allowed']);expect(result.total).toBe(1);expect(JSON.stringify(result)).not.toContain('private');expect(result.entries[0]).not.toHaveProperty('rel');expect(result.entries[0]).not.toHaveProperty('identity');expect(result.entries[0]).not.toHaveProperty('playback')})
 it('短中文搜索不泄露未共享文件或计数',()=>{const result=browse({text:'西湖'});expect(result.total).toBe(1);expect(result.entries.map(e=>e.id)).toEqual(['allowed-img']);expect(()=>browse({folderId:'hidden'})).toThrow('SHARE_NOT_FOUND');expect(()=>db.sharedEntry(['allowed'],'private-img')).toThrow('SHARE_NOT_FOUND')})
 it('面包屑不包含未共享的上级目录',()=>{const result=browse({folderId:'nested'});expect(result.breadcrumbs).toEqual([{id:'allowed',name:'共享'},{id:'nested',name:'子目录'}]);expect(result.entries.map(e=>e.id)).toEqual(['video'])})
 it('父级授权覆盖子目录，重复授权不重复列出媒体',()=>{const result=db.sharedBrowse(['allowed','nested'],shareBrowseSchema.parse({text:'movie'}));expect(result.total).toBe(1);expect(result.entries.map(e=>e.id)).toEqual(['video'])})
 it('分页、类型过滤与标签检索保持授权范围',()=>{db.organize({ids:['allowed-img','private-img']},'tag-add','旅行');expect(browse({text:'旅行'}).total).toBe(1);expect(browse({text:'movie',kind:'image'}).total).toBe(0);expect(browse({folderId:'allowed',limit:1}).entries).toHaveLength(1);expect(browse({folderId:'allowed',offset:1,limit:1}).entries).toHaveLength(1);expect(browse({folderId:'allowed',offset:2}).entries).toHaveLength(0)})
 it('首页选择媒体类型直接查找所有授权目录中的媒体',()=>{expect(browse({kind:'video'}).entries.map(e=>e.id)).toEqual(['video']);expect(browse({kind:'image'}).entries.map(e=>e.id)).toEqual(['allowed-img'])})
 it('移动到未共享区域后立即失去授权，离线不泄露文件路径',()=>{db.relocate('allowed-img','root','hidden','隐私/moved.jpg','moved.jpg');expect(()=>db.sharedEntry(['allowed'],'allowed-img')).toThrow('SHARE_NOT_FOUND');db.rootState('root','offline');expect(browse().entries[0]?.online).toBe(false);db.archiveRoot('root');expect(browse().total).toBe(0)})
})
