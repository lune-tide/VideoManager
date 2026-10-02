/* v0.9.2 主题工坊：多主题预设 + 双色渐变 + 极光氛围变量。
   兼容旧 accentColor 自定义行为：自定义颜色优先，未设置时按预设应用。 */
export const themePresets=[
 {id:'aurora',name:'极光',accent:'#55d6b7',accent2:'#818cf8'},
 {id:'ocean',name:'深海',accent:'#60a5fa',accent2:'#22d3ee'},
 {id:'nebula',name:'星云',accent:'#a78bfa',accent2:'#f0abfc'},
 {id:'sunset',name:'暖阳',accent:'#fbbf24',accent2:'#fb7185'},
 {id:'blossom',name:'樱粉',accent:'#fb7185',accent2:'#c084fc'},
 {id:'forest',name:'翠野',accent:'#34d399',accent2:'#a3e635'},
 {id:'graphite',name:'石墨',accent:'#94a3b8',accent2:'#e2e8f0'}
] as const
export type ThemePresetId=typeof themePresets[number]['id']
const presetIds=new Set<string>(themePresets.map(item=>item.id))
export const isThemePreset=(value:unknown):value is ThemePresetId=>typeof value==='string'&&presetIds.has(value)
export function normalizeHexColor(value:unknown):string|null{
 if(typeof value!=='string')return null
 const hex=value.trim().toLowerCase()
 if(/^#[0-9a-f]{6}$/.test(hex))return hex
 if(/^#[0-9a-f]{3}$/.test(hex))return '#'+Array.from(hex.slice(1),char=>char+char).join('')
 return null
}
const luminance=(rgb:number[])=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i]!,0)
const contrast=(a:number,b:number)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05)
const hexToRgb=(hex:string)=>[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16))
const rgbToHex=(rgb:number[])=>'#'+rgb.map(channel=>Math.round(Math.max(0,Math.min(255,channel))).toString(16).padStart(2,'0')).join('')
/* 与背景拉开 4.5:1 对比度：深色向白收敛、浅色向黑收敛（与 v0.9.0 行为一致）。 */
function adjustForBackground(hex:string,dark:boolean){
 const background=luminance(dark?[24,33,43]:[255,255,255])
 let rgb=hexToRgb(hex)
 for(let i=0;i<30&&contrast(luminance(rgb),background)<4.5;i++)rgb=rgb.map(channel=>Math.round(channel*.92+(dark?255:0)*.08))
 return rgbToHex(rgb)
}
/* 十六进制 → HSL 旋转色相后转回，用于为自定义颜色派生渐变搭档色。 */
function hueShift(hex:string,degrees:number){
 const [r=0,g=0,b=0]=hexToRgb(hex).map(v=>v/255);const max=Math.max(r,g,b),min=Math.min(r,g,b);const l=(max+min)/2;let h=0,s=0
 if(max!==min){const d=max-min;s=l>.5?d/(2-max-min):d/(max+min);h=max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4;h/=6}
 h=(h+degrees/360+1)%1
 const hue2rgb=(p:number,q:number,t:number)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p}
 let r2:number,g2:number,b2:number
 if(s===0)r2=g2=b2=l;else{const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;r2=hue2rgb(p,q,h+1/3);g2=hue2rgb(p,q,h);b2=hue2rgb(p,q,h-1/3)}
 return rgbToHex([r2*255,g2*255,b2*255])
}
export function themeVariables(themePreset:unknown,accentColor:unknown,dark:boolean):Record<string,string>{
 const custom=normalizeHexColor(accentColor)
 const preset=themePresets.find(item=>item.id===themePreset)??themePresets[0]
 const accent=adjustForBackground(custom??preset.accent,dark)
 const accent2=adjustForBackground(custom?hueShift(custom,42):preset.accent2,dark)
 const light=luminance(hexToRgb(accent))
 const onWhite=contrast(light,1),onBlack=contrast(light,luminance([7,16,24]))
 const vars:Record<string,string>={
  '--accent':accent,
  '--accent-2':accent2,
  '--on-accent':onWhite>=onBlack?'#ffffff':'#071018',
  '--accent-wash':accent+'16',
  '--accent-wash-strong':accent+'2e',
  '--accent-dim':accent+'45',
  '--accent-grad':`linear-gradient(135deg, ${accent}, ${accent2})`,
  '--glow':dark?accent2+'59':accent+'45',
  '--aurora-1':(custom?accent:preset.accent)+'2e',
  '--aurora-2':(custom?accent2:preset.accent2)+'2b',
  '--aurora-3':hueShift(custom?accent2:preset.accent2,-32)+'24',
  '--folder-color':accent,
  '--folder-bg':`color-mix(in srgb, ${accent} 12%, var(--surface))`,
  '--art-bg':`color-mix(in srgb, ${accent} 12%, var(--surface))`,
  '--art-border':accent+'70',
  '--art-icon':accent,
  '--tag-purple':accent,
  '--tag-blue':accent
 }
 return vars
}
export function applyTheme(themePreset:unknown,accentColor:unknown,dark:boolean){
 for(const [name,color]of Object.entries(themeVariables(themePreset,accentColor,dark)))document.documentElement.style.setProperty(name,color)
}
