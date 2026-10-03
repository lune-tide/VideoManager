import { z } from 'zod'

export const shareOptionsSchema = z.object({
  host: z.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}$/),
  port: z.number().int().min(1024).max(65535),
  folderIds: z.array(z.string().min(1).max(200)).min(1).max(64),
  maxDevices: z.number().int().min(1).max(16).default(6),
  keepInTray: z.boolean().default(true)
}).strict()
export type ShareOptions = z.infer<typeof shareOptionsSchema>
export const shareBrowseSchema = z.object({
  folderId: z.string().min(1).max(200).nullable().default(null),
  text: z.string().trim().max(150).default(''),
  kind: z.enum(['', 'image', 'video']).default(''),
  offset: z.number().int().min(0).max(1000000).default(0),
  limit: z.number().int().min(1).max(100).default(60)
}).strict()
export type ShareBrowse = z.infer<typeof shareBrowseSchema>
export type SharedEntry = {
  id: string; name: string; kind: 'folder' | 'image' | 'video'; ext: string;
  size: number; mtime: number; width: number | null; height: number | null;
  duration: number | null; revision: number; coverRevision: number; tags: string[]; online: boolean
}
export type SharedPage = { entries: SharedEntry[]; total: number; breadcrumbs: { id: string; name: string }[] }
export type ShareDevice = { id: string; name: string; address: string; connectedAt: number; lastSeen: number; expires: number; playing: string; streams: number }
export type ShareStatus = {
  running: boolean; url: string; connectionUrl: string; qr: string; qrExpires: number;
  options: ShareOptions | null; devices: ShareDevice[]; error: string;
  interfaces: { name: string; address: string; loopback: boolean }[]
}
