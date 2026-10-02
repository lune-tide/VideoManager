import {useEffect,useRef,useState,type KeyboardEvent} from 'react'
import {Check,Palette,Sparkles,FolderOpen} from 'lucide-react'
import {themePresets,isThemePreset,normalizeHexColor} from './palette'

/** 编辑只改草稿，明确应用时一次保存，避免 blur 与 click 竞争导致应用失效。 */
export function ThemePalette({value,accentColor,busy,save}:{value:unknown;accentColor:unknown;busy:boolean;save:(patch:Record<string,unknown>)=>void}){
 const color=normalizeHexColor(accentColor)
 const isCustom=!!color
 const currentPreset=isThemePreset(value)?value:'aurora'
 const preset=themePresets.find(item=>item.id===currentPreset)!
 const [draft,setDraft]=useState(color??preset.accent)
 const [error,setError]=useState('')
 const input=useRef<HTMLInputElement>(null),focusAfterSave=useRef(false)
 useEffect(()=>{setDraft(color??preset.accent);setError('')},[color,preset.accent])
 useEffect(()=>{if(!busy&&focusAfterSave.current){focusAfterSave.current=false;input.current?.focus()}},[busy])
 const edit=(value:string)=>{setDraft(value);setError('')}
 const commit=()=>{
  const next=normalizeHexColor(draft)
  if(!next){setError('请输入有效的十六进制颜色，例如 #55d6b7 或 #5db。');return}
  setDraft(next);setError('');save({accentColor:next,themePreset:'custom'})
 }
 const customize=()=>{
  if(!isCustom){focusAfterSave.current=true;save({accentColor:preset.accent,themePreset:'custom'})}
  else input.current?.focus()
 }
 const choose=(id:string)=>{setError('');save({themePreset:id,accentColor:null})}
 const keyboard=(event:KeyboardEvent<HTMLDivElement>)=>{
  const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]'))
  const index=buttons.indexOf(event.target as HTMLButtonElement)
  if(index<0||busy)return
  let next=index
  if(['ArrowRight','ArrowDown'].includes(event.key))next=(index+1)%buttons.length
  else if(['ArrowLeft','ArrowUp'].includes(event.key))next=(index-1+buttons.length)%buttons.length
  else if(event.key==='Home')next=0
  else if(event.key==='End')next=buttons.length-1
  else return
  event.preventDefault();buttons[next]?.focus();buttons[next]?.click()
 }
 const dirty=normalizeHexColor(draft)!==color||!isCustom
 return <div className="theme-palette" aria-busy={busy}>
  <div className="palette-heading"><div><strong><Palette size={17}/>界面主题</strong><small>选择喜欢的色调。强调色会随界面明暗自动调整，兼顾个性与清晰可读。</small></div><button className="text-button" disabled={busy} onClick={()=>choose('aurora')}>恢复默认</button></div>
  <div className="preset-grid" role="radiogroup" aria-label="界面主题预设" onKeyDown={keyboard}>
   {themePresets.map(item=>{
    const selected=!isCustom&&currentPreset===item.id
    return <button key={item.id} role="radio" aria-checked={selected} tabIndex={selected?0:-1} aria-label={item.name+'主题'} title={item.name+'主题'} disabled={busy} className={'preset-card'+(selected?' selected':'')} onClick={()=>choose(item.id)}>
     <span className="preset-preview" style={{background:`linear-gradient(135deg, ${item.accent}, ${item.accent2})`}}>{selected&&<Check size={16}/>}</span><small>{item.name}</small>
    </button>
   })}
   <button role="radio" aria-checked={isCustom} tabIndex={isCustom?0:-1} aria-label="自定义主题" title="自定义主题" disabled={busy} className={'preset-card'+(isCustom?' selected':'')} onClick={customize}>
    <span className="preset-preview" style={{background:isCustom?color:'conic-gradient(from 45deg,#55d6b7,#60a5fa,#a78bfa,#fb7185,#fbbf24,#55d6b7)'}}>{isCustom?<Check size={16}/>:<Sparkles size={16}/>}</span><small>自定义</small>
   </button>
  </div>
  <div className="palette-custom">
   <label>自定义颜色<input aria-label="选择自定义主题颜色" type="color" value={normalizeHexColor(draft)??color??preset.accent} disabled={busy} onChange={event=>edit(event.target.value)}/></label>
   <input ref={input} aria-label="主题颜色十六进制值" aria-invalid={!!error} aria-describedby={error?'palette-error':'palette-help'} value={draft} maxLength={9} placeholder="#55d6b7" spellCheck={false} disabled={busy} onChange={event=>edit(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();commit()}}}/>
   <button className="secondary" disabled={busy||!dirty} onClick={commit}><Check size={15}/>应用颜色</button>
   <small id="palette-help" className="palette-help">支持 #RRGGBB 与 #RGB。选择或输入颜色后，点击“应用颜色”或按 Enter 保存。</small>
  </div>
  {error&&<p id="palette-error" className="palette-error" role="alert">{error}</p>}
  <div className="palette-sample" aria-label="当前主题预览"><span><FolderOpen size={19}/></span><div><strong>你的媒体库</strong><small>文件夹、选中状态与主要操作使用统一强调色</small></div><span className="badge">{isCustom?'自定义主题':preset.name+'主题'}</span></div>
 </div>
}
