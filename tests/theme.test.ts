import {describe,it,expect} from 'vitest'
import {normalizeHexColor,themePresets,themeVariables} from '../apps/desktop/src/renderer/palette'

const luminance=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i]!,0)
const contrast=(a:string,b:string)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}

describe('主题颜色与可读性',()=>{
 it('标准化大小写、空白与三位颜色，拒绝无效输入',()=>{
  expect(normalizeHexColor(' #5DB ')).toBe('#55ddbb')
  expect(normalizeHexColor('#Aa00Ff')).toBe('#aa00ff')
  for(const value of [null,{},42,'red','#zzzzzz','#12','#12345678'])expect(normalizeHexColor(value)).toBeNull()
 })
 for(const dark of [false,true])it((dark?'深色':'浅色')+'预设与极端自定义色均满足强调色、按钮文字对比度',()=>{
  for(const preset of themePresets)for(const custom of [null,'#000000','#ffffff','#777777','#ff0000','#0000ff','#00ff00']){
   const vars=themeVariables(preset.id,custom,dark)
   for(const name of ['--accent','--accent-2'])expect(contrast(vars[name]!,dark?'#18212b':'#ffffff')).toBeGreaterThanOrEqual(4.5)
   expect(contrast(vars['--accent']!,vars['--on-accent']!)).toBeGreaterThanOrEqual(4.5)
   expect(Object.values(vars).join('')).not.toMatch(/NaN|undefined/)
  }
 })
 it('未知预设、缺少自定义色和旧设置均回退到默认主题',()=>{
  const defaultTheme=themeVariables('aurora',null,true)
  expect(themeVariables('custom',null,true)).toEqual(defaultTheme)
  expect(themeVariables('missing','invalid',true)).toEqual(defaultTheme)
  expect(themeVariables(undefined,undefined,true)).toEqual(defaultTheme)
 })
 it('旧 accentColor 设置仍优先，自定义搭档色一致',()=>{
  expect(themeVariables('ocean','#aabbcc',false)).toEqual(themeVariables('custom','#abc',false))
  expect(themeVariables('custom','#ff3300',true)['--accent-2']).not.toBe(themeVariables('custom','#ff3300',true)['--accent'])
 })
})
