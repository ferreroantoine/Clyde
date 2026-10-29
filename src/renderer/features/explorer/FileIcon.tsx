import {
  File,
  FileCode2,
  FileCog,
  FileImage,
  FileJson,
  FileLock,
  FileText,
  FileTerminal,
  Folder,
  FolderOpen,
  type LucideIcon
} from 'lucide-react'
import { cn } from '@/lib/utils'

const BY_EXT: Record<string, [LucideIcon, string]> = {
  ts: [FileCode2, 'text-sky-500'],
  tsx: [FileCode2, 'text-sky-500'],
  js: [FileCode2, 'text-amber-500'],
  jsx: [FileCode2, 'text-amber-500'],
  mjs: [FileCode2, 'text-amber-500'],
  cjs: [FileCode2, 'text-amber-500'],
  py: [FileCode2, 'text-emerald-500'],
  rs: [FileCode2, 'text-orange-500'],
  go: [FileCode2, 'text-cyan-500'],
  java: [FileCode2, 'text-red-400'],
  cs: [FileCode2, 'text-violet-500'],
  css: [FileCode2, 'text-indigo-400'],
  scss: [FileCode2, 'text-pink-400'],
  html: [FileCode2, 'text-orange-400'],
  json: [FileJson, 'text-yellow-500'],
  md: [FileText, 'text-slate-400'],
  txt: [FileText, 'text-slate-400'],
  yml: [FileCog, 'text-rose-400'],
  yaml: [FileCog, 'text-rose-400'],
  toml: [FileCog, 'text-rose-400'],
  ps1: [FileTerminal, 'text-blue-400'],
  sh: [FileTerminal, 'text-green-500'],
  png: [FileImage, 'text-purple-400'],
  jpg: [FileImage, 'text-purple-400'],
  svg: [FileImage, 'text-purple-400'],
  lock: [FileLock, 'text-slate-400']
}

export function FileIcon({ name, dir, open, className }: { name: string; dir?: boolean; open?: boolean; className?: string }) {
  if (dir) {
    const Icon = open ? FolderOpen : Folder
    return <Icon className={cn('size-4 shrink-0 text-muted-foreground', className)} strokeWidth={1.6} />
  }
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  const [Icon, color] = BY_EXT[ext] ?? [File, 'text-muted-foreground']
  return <Icon className={cn('size-4 shrink-0', color, className)} strokeWidth={1.6} />
}
