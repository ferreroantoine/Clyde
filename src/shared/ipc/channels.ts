// Dependency-free so the sandboxed preload can import it.

export const INVOKE_CHANNELS = [
  'app:getInfo',
  'workspace:pick',
  'workspace:open',
  'workspace:current',
  'fs:list',
  'fs:read',
  'fs:write',
  'search:text',
  'pty:create',
  'pty:write',
  'pty:resize',
  'pty:kill',
  'settings:getAll',
  'settings:set',
  'profiles:list',
  'profiles:create',
  'profiles:update',
  'profiles:delete',
  'profiles:test',
  'profiles:login',
  'agent:list',
  'agent:start',
  'agent:send',
  'agent:interrupt',
  'agent:stop',
  'agent:approve',
  'mcp:list',
  'mcp:create',
  'mcp:update',
  'mcp:delete',
  'mcp:reconnect',
  'mcp:importPreview',
  'mcp:import'
] as const

export const EVENT_CHANNELS = [
  'workspace:changed',
  'fs:changed',
  'pty:data',
  'pty:exit',
  'profiles:changed',
  'agent:session',
  'agent:event',
  'mcp:changed'
] as const

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]
export type EventChannel = (typeof EVENT_CHANNELS)[number]
