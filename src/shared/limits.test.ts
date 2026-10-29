import { describe, expect, it } from 'vitest'
import {
  attributeDelta,
  crossedThresholds,
  formatCountdown,
  parseClaudeStatusLine,
  parseClaudeUsage,
  parseCodexRateLimits,
  windowDelta
} from './limits'

describe('limit parsers', () => {
  it('reads Claude Code’s structured /usage, with per-model windows', () => {
    const readings = parseClaudeUsage({
      session: {},
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 23.46, resets_at: '2026-10-29T20:00:00Z' },
        seven_day: { utilization: 41.2, resets_at: '2026-11-02T09:00:00Z' },
        seven_day_opus: null,
        seven_day_sonnet: { utilization: null, resets_at: null },
        model_scoped: [{ display_name: 'Fable', utilization: 12, resets_at: '2026-11-02T09:00:00Z' }]
      }
    })
    expect(readings).toEqual([
      { window: 'five_hour', label: '5-hour window', usedPct: 23.5, resetsAt: Date.parse('2026-10-29T20:00:00Z'), source: 'claude-usage' },
      { window: 'seven_day', label: 'Weekly', usedPct: 41.2, resetsAt: Date.parse('2026-11-02T09:00:00Z'), source: 'claude-usage' },
      { window: 'model:fable', label: 'Weekly · Fable', usedPct: 12, resetsAt: Date.parse('2026-11-02T09:00:00Z'), source: 'claude-usage' }
    ])
    expect(parseClaudeUsage({ rate_limits: null, rate_limits_available: false })).toEqual([])
  })

  it('reads the status line JSON (epoch seconds), each window optional', () => {
    expect(
      parseClaudeStatusLine({ model: {}, rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 } } })
    ).toEqual([{ window: 'five_hour', label: '5-hour window', usedPct: 23.5, resetsAt: 1738425600000, source: 'claude-statusline' }])
    expect(parseClaudeStatusLine({ model: {} })).toEqual([])
  })

  it('maps Codex windows by their length, and copes with a plan without a 5-hour window', () => {
    const weekOnly = parseCodexRateLimits({
      limitId: 'codex',
      limitName: null,
      primary: null,
      secondary: { usedPercent: 12, windowDurationMins: 10_080, resetsAt: 1_800_000_000 }
    })
    expect(weekOnly).toEqual([{ window: 'seven_day', label: 'Weekly', usedPct: 12, resetsAt: 1_800_000_000_000, source: 'codex' }])
    const both = parseCodexRateLimits(
      {
        limitId: 'codex',
        limitName: null,
        primary: { usedPercent: 55, windowDurationMins: 300, resetsAt: 1_799_990_000 },
        secondary: { usedPercent: 20, windowDurationMins: 10_080, resetsAt: 1_800_000_000 }
      },
      {
        codex: undefined,
        spark: { limitId: 'spark', limitName: 'GPT-6 Spark', primary: { usedPercent: 3, windowDurationMins: 1440, resetsAt: null }, secondary: null }
      }
    )
    expect(both.map((r) => [r.window, r.label, r.usedPct])).toEqual([
      ['five_hour', '5-hour window', 55],
      ['seven_day', 'Weekly', 20],
      ['bucket:spark:codex:1440m', '1-day window · GPT-6 Spark', 3]
    ])
  })
})

describe('per-session attribution', () => {
  it('measures a window’s growth, including across a reset', () => {
    const r = 1_000_000_000_000
    expect(windowDelta(null, { usedPct: 30, resetsAt: r })).toBe(0)
    expect(windowDelta({ usedPct: 30, resetsAt: r }, { usedPct: 34.5, resetsAt: r + 30_000 })).toBe(4.5)
    expect(windowDelta({ usedPct: 30, resetsAt: r }, { usedPct: 29, resetsAt: r })).toBe(0)
    // The window reset in between: the new period's usage is all new.
    expect(windowDelta({ usedPct: 90, resetsAt: r }, { usedPct: 6, resetsAt: r + 5 * 3_600_000 })).toBe(6)
  })

  it('gives one session the whole delta (official), and splits by tokens when several ran (estimated)', () => {
    expect(attributeDelta(4, [{ sessionId: 'a', tokens: 0 }])).toEqual([{ sessionId: 'a', deltaPct: 4, badge: 'official' }])
    expect(
      attributeDelta(6, [
        { sessionId: 'a', tokens: 3000 },
        { sessionId: 'b', tokens: 1000 }
      ])
    ).toEqual([
      { sessionId: 'a', deltaPct: 4.5, badge: 'estimated' },
      { sessionId: 'b', deltaPct: 1.5, badge: 'estimated' }
    ])
    expect(attributeDelta(2, [{ sessionId: 'a', tokens: 0 }, { sessionId: 'b', tokens: 0 }]).map((x) => x.deltaPct)).toEqual([1, 1])
    expect(attributeDelta(0, [{ sessionId: 'a', tokens: 5 }])).toEqual([])
  })

  it('finds the alert thresholds a window just crossed', () => {
    expect(crossedThresholds(70, 92, [90, 75])).toEqual([75, 90])
    expect(crossedThresholds(80, 85, [75, 90])).toEqual([])
    expect(crossedThresholds(null, 76, [75, 90])).toEqual([75])
  })

  it('formats the time left before a reset', () => {
    expect(formatCountdown(125 * 60_000)).toBe('2 h 05 min')
    expect(formatCountdown(3 * 86_400_000 + 4 * 3_600_000)).toBe('3 d 4 h')
    expect(formatCountdown(0)).toBe('now')
  })
})
