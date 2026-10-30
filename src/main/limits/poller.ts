import { watch, type FSWatcher } from 'chokidar'
import { join } from 'node:path'
import { isEnded, type AgentSessionInfo } from '@shared/agent'
import type { LimitReading } from '@shared/limits'
import type { Profile } from '@shared/profiles'
import { BRIDGE_JSON, readBridge } from './claude-bridge'

const TICK_MS = 60_000

export interface PollerDeps {
  profiles: () => Profile[]
  activeSessions: () => AgentSessionInfo[]
  intervalMinutes: () => number
  /** Reads one account's limits without a prompt; empty when the CLI reports none. */
  read: (profile: Profile) => Promise<LimitReading[]>
  ingest: (profileId: string, readings: LimitReading[]) => void
  log: (message: string, err?: unknown) => void
  now?: () => number
}

/** Kinds whose CLI can report plan limits without sending a prompt. */
const POLLED = new Set(['claude-code', 'codex'])

/**
 * Reads subscription limits in the background, at the interval set in Settings, for accounts
 * with no running agent (running agents report theirs after each turn).
 */
export class LimitsPoller {
  private timer: NodeJS.Timeout | null = null
  private readonly lastRead = new Map<string, number>()
  private readonly inFlight = new Set<string>()

  constructor(private readonly deps: PollerDeps) {}

  start(firstDelayMs = 20_000): void {
    this.timer = setTimeout(() => this.tick(), firstDelayMs)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Reads now: one account, or every polled subscription account. */
  async refresh(profileId?: string): Promise<void> {
    const targets = this.targets().filter((p) => !profileId || p.id === profileId)
    await Promise.all(targets.map((p) => this.readOne(p)))
  }

  private targets(): Profile[] {
    return this.deps.profiles().filter((p) => p.auth === 'subscription' && p.usable && POLLED.has(p.kind))
  }

  private async tick(): Promise<void> {
    const now = this.deps.now?.() ?? Date.now()
    const interval = this.deps.intervalMinutes() * 60_000
    const busy = new Set(this.deps.activeSessions().filter((s) => !isEnded(s.status)).map((s) => s.profileId))
    const due = this.targets().filter((p) => {
      const last = this.lastRead.get(p.id)
      return !busy.has(p.id) && (last === undefined || now - last >= interval)
    })
    // One at a time: each read starts a CLI process.
    for (const p of due) await this.readOne(p)
    if (this.timer !== null) this.timer = setTimeout(() => this.tick(), TICK_MS)
  }

  private async readOne(profile: Profile): Promise<void> {
    if (this.inFlight.has(profile.id)) return
    this.inFlight.add(profile.id)
    try {
      const readings = await this.deps.read(profile)
      this.lastRead.set(profile.id, this.deps.now?.() ?? Date.now())
      this.deps.ingest(profile.id, readings)
    } catch (err) {
      this.lastRead.set(profile.id, this.deps.now?.() ?? Date.now())
      this.deps.log(`could not read the limits of ${profile.name}`, err)
    } finally {
      this.inFlight.delete(profile.id)
    }
  }
}

/** Watches the status line bridge file of each Claude profile and passes new readings on. */
export class BridgeWatcher {
  private readonly watchers = new Map<string, FSWatcher>()

  constructor(private readonly onReadings: (profileId: string, readings: LimitReading[]) => void) {}

  /** Watches exactly these profile folders. */
  sync(dirs: Array<{ profileId: string; dir: string }>): void {
    const wanted = new Set(dirs.map((d) => d.profileId))
    for (const [id, w] of this.watchers) {
      if (!wanted.has(id)) {
        void w.close()
        this.watchers.delete(id)
      }
    }
    for (const { profileId, dir } of dirs) {
      if (this.watchers.has(profileId)) continue
      const w = watch(join(dir, BRIDGE_JSON), { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } })
      const read = () => {
        const readings = readBridge(dir)
        if (readings.length) this.onReadings(profileId, readings)
      }
      w.on('add', read).on('change', read)
      this.watchers.set(profileId, w)
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.watchers.values()].map((w) => w.close()))
    this.watchers.clear()
  }
}
