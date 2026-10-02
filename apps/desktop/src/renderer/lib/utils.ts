import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** 合并 Tailwind 类名（AceternityUI 组件惯例），同时保留旧类名的确定性。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
