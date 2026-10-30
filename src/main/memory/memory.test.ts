import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { lineDiff } from '@shared/memory'
import type { Profile } from '@shared/profiles'
import { migrate } from '../services/db/database'
import type { InternalModel } from '../context/internal'
import { BLOCK_END, BLOCK_START, blockContent, docFileName, upsertBlock } from './files'
import { MemoryService, parseProposal } from './service'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p))

describe('managed block', () => {
  it('appends, replaces and removes only its own block', () => {
    const user = '# My project\n\nHand-written rules.\n'
    const once = upsertBlock(user, '- Use pnpm.')
    expect(once.startsWith(user.trimEnd())).toBe(true)
    expect(once).toContain(`${BLOCK_START}\n<!--`)
    expect(once).toContain('- Use pnpm.\n' + BLOCK_END)
    const twice = upsertBlock(`${once}\nMore rules after.\n`, '- Use npm.')
    expect(twice).toContain('- Use npm.')
    expect(twice).not.toContain('pnpm')
    expect(twice).toContain('Hand-written rules.')
    expect(twice).toContain('More rules after.')
    expect(twice.match(new RegExp(BLOCK_START, 'g'))).toHaveLength(1)
    const removed = upsertBlock(twice, '')
    expect(removed).not.toContain(BLOCK_START)
    expect(removed).toContain('More rules after.')
    expect(upsertBlock('', '- a')).toMatch(/^<!-- clyde:memory -->/)
  })

  it('lists detailed notes after the core', () => {
    expect(blockContent('- core', [{ name: 'release.md', title: 'Release process', content: '' }], '.clyde/memory/docs')).toBe(
      '- core\n\nDetailed notes, to read only when the task needs them (in .clyde/memory/docs):\n- release.md: Release process'
    )
    expect(docFileName('Processus de déploiement !')).toBe('processus-de-deploiement.md')
  })
})

function setup() {
  const db = new Database(':memory:')
  migrate(db)
  const repo = tmp('clyde-mem-repo-')
  const userDir = tmp('clyde-mem-user-')
  const configs = tmp('clyde-mem-cfg-')
  const profiles = [
    { id: 'c', kind: 'claude-code', auth: 'subscription' },
    { id: 'x', kind: 'codex', auth: 'subscription' },
    { id: 'g', kind: 'antigravity', auth: 'subscription' },
    { id: 'a', kind: 'anthropic', auth: 'api-key' },
    { id: 'o', kind: 'ollama', auth: 'none' }
  ] as Profile[]
  const complete = vi.fn(async () => '')
  const changes: unknown[] = []
  const memory = new MemoryService({
    db,
    userDir,
    workspaceRoot: () => repo,
    profiles: () => profiles,
    configDir: (id) => {
      // As the real one: API and Ollama accounts have no config folder.
      if (id === 'a' || id === 'o') throw new Error('API accounts have no config folder')
      return join(configs, id)
    },
    budget: () => 1500,
    internal: { complete } as unknown as InternalModel,
    transcript: () => 'User: we use pnpm and vitest here, never npm.\n'.repeat(10),
    onChanged: (s) => changes.push(s)
  })
  return { db, repo, userDir, configs, memory, complete, changes }
}

describe('MemoryService', () => {
  it('syncs the project core to CLAUDE.md and AGENTS.md, and the user core to each account', () => {
    const h = setup()
    writeFileSync(join(h.repo, 'CLAUDE.md'), '# Rules\n\nKeep mine.\n')
    h.memory.saveCore('project', '- Package manager: pnpm.')
    h.memory.saveDoc('project', null, 'Release process', '# Release process\n\nTag, then publish.')
    h.memory.saveCore('user', '- I prefer short answers in French.')

    const claude = readFileSync(join(h.repo, 'CLAUDE.md'), 'utf8')
    expect(claude).toContain('Keep mine.')
    expect(claude).toContain('- Package manager: pnpm.')
    expect(claude).toContain('- release-process.md: Release process')
    expect(claude).not.toContain('short answers')
    expect(readFileSync(join(h.repo, 'AGENTS.md'), 'utf8')).toContain('pnpm')
    // GEMINI.md is only updated when the project has one.
    expect(existsSync(join(h.repo, 'GEMINI.md'))).toBe(false)
    writeFileSync(join(h.repo, 'GEMINI.md'), 'Legacy rules.\n')
    h.memory.sync()
    expect(readFileSync(join(h.repo, 'GEMINI.md'), 'utf8')).toContain('pnpm')

    expect(readFileSync(join(h.configs, 'c', 'CLAUDE.md'), 'utf8')).toContain('short answers in French')
    expect(readFileSync(join(h.configs, 'x', 'AGENTS.md'), 'utf8')).toContain('short answers in French')
    expect(readFileSync(join(h.configs, 'g', '.gemini', 'GEMINI.md'), 'utf8')).toContain('short answers in French')
    expect(existsSync(join(h.configs, 'a'))).toBe(false)

    const state = h.memory.state()
    expect(state.project?.tokens).toBe(Math.ceil('- Package manager: pnpm.\n'.length / 4))
    expect(state.project?.docs.map((d) => d.name)).toEqual(['release-process.md'])
  })

  it('gives API agents both cores in their prompt', () => {
    const h = setup()
    expect(h.memory.forPrompt()).toBe('')
    h.memory.saveCore('user', '- Name: Antoine.')
    h.memory.saveCore('project', '- Tests: vitest.')
    const prompt = h.memory.forPrompt()
    expect(prompt).toContain('## About the user\n- Name: Antoine.')
    expect(prompt).toContain('## This project\n- Tests: vitest.')
  })

  it('never writes secrets into memory files', () => {
    const h = setup()
    const state = h.memory.saveCore('project', '- Deploy key: sk-ant-api03-abcdefghijklmnop\n- token: use JWT for the API')
    expect(state.redacted).toBe(true)
    const core = readFileSync(join(h.repo, '.clyde', 'memory', 'core.md'), 'utf8')
    expect(core).not.toContain('abcdefghijklmnop')
    expect(core).toContain('token: use JWT')
    expect(readFileSync(join(h.repo, 'CLAUDE.md'), 'utf8')).not.toContain('abcdefghijklmnop')
  })

  it('turns a session into proposals that only apply once accepted', async () => {
    const h = setup()
    h.memory.saveCore('project', '- Tests: jest.')
    h.complete.mockResolvedValueOnce('Here you go: {"user": null, "project": "- Tests: vitest.\\n- Package manager: pnpm.", "reason": "The session switched to vitest."}')
    const made = await h.memory.proposeFromSession('as-1')
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ scope: 'project', kind: 'session', before: '- Tests: jest.\n', reason: 'The session switched to vitest.' })
    expect(readFileSync(join(h.repo, '.clyde', 'memory', 'core.md'), 'utf8')).toBe('- Tests: jest.\n')
    h.memory.accept(made[0]?.id as string)
    expect(readFileSync(join(h.repo, '.clyde', 'memory', 'core.md'), 'utf8')).toContain('pnpm')
    expect(h.memory.proposals()).toEqual([])

    h.complete.mockResolvedValueOnce('- Tests: vitest.')
    const tidy = await h.memory.consolidate('project')
    expect(tidy?.kind).toBe('consolidate')
    h.memory.reject(tidy?.id as string)
    expect(readFileSync(join(h.repo, '.clyde', 'memory', 'core.md'), 'utf8')).toContain('pnpm')
  })

  it('parses proposals defensively', () => {
    expect(parseProposal('nope')).toBeNull()
    expect(parseProposal('{"user": "  ", "project": null}')).toEqual({ user: null, project: null, reason: '' })
  })
})

describe('lineDiff', () => {
  it('marks added and removed lines', () => {
    expect(lineDiff('a\nb\nc', 'a\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'remove', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' }
    ])
  })
})

// The memory folder is created on first save only.
it('does not create memory files before something is saved', () => {
  const h = setup()
  h.memory.sync()
  expect(existsSync(join(h.repo, 'CLAUDE.md'))).toBe(false)
})
