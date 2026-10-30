import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@shared/agent'
import { ApprovalBroker, sessionRuleFor } from './broker'

function setup() {
  const events: Array<{ sessionId: string; event: AgentEvent }> = []
  const broker = new ApprovalBroker((sessionId, event) => events.push({ sessionId, event }))
  const lastRequestId = () => {
    const req = [...events].reverse().find((e) => e.event.type === 'approval_request')
    return req && req.event.type === 'approval_request' ? req.event.requestId : ''
  }
  return { broker, events, lastRequestId }
}

const bash = (command: string) => ({ toolUseId: 't1', toolName: 'Bash', input: { command }, reason: 'Shell commands need your approval' })

describe('ApprovalBroker', () => {
  it('waits for the answer and allows once', async () => {
    const { broker, events, lastRequestId } = setup()
    const outcome = broker.ask('s1', bash('npm test'))
    expect(broker.hasPending('s1')).toBe(true)
    expect(events[0]?.event).toMatchObject({ type: 'approval_request', toolName: 'Bash', input: { command: 'npm test' } })
    broker.answer('s1', lastRequestId(), 'allow-once')
    await expect(outcome).resolves.toEqual({ behavior: 'allow' })
    expect(events.at(-1)?.event).toMatchObject({ type: 'approval_resolved', decision: 'allow-once' })

    // Allow once does not cover the next call.
    void broker.ask('s1', bash('npm test'))
    expect(broker.hasPending('s1')).toBe(true)
  })

  it('passes the denial message to the agent', async () => {
    const { broker, lastRequestId } = setup()
    const outcome = broker.ask('s1', bash('rm -rf build'))
    broker.answer('s1', lastRequestId(), 'deny', 'Use npm run clean instead')
    await expect(outcome).resolves.toEqual({ behavior: 'deny', message: 'Use npm run clean instead' })
  })

  it('remembers allow-for-session per exact command and per session', async () => {
    const { broker, lastRequestId } = setup()
    const first = broker.ask('s1', bash('npm test'))
    broker.answer('s1', lastRequestId(), 'allow-session')
    await first
    await expect(broker.ask('s1', bash('npm test'))).resolves.toEqual({ behavior: 'allow' })
    void broker.ask('s1', bash('npm publish'))
    expect(broker.hasPending('s1')).toBe(true)
    void broker.ask('s2', bash('npm test'))
    expect(broker.hasPending('s2')).toBe(true)
  })

  it('rejects answers for unknown or foreign requests', () => {
    const { broker, lastRequestId } = setup()
    void broker.ask('s1', bash('ls'))
    expect(() => broker.answer('s2', lastRequestId(), 'allow-once')).toThrow(/already answered/)
    broker.answer('s1', lastRequestId(), 'allow-once')
    expect(() => broker.answer('s1', lastRequestId(), 'allow-once')).toThrow(/already answered/)
  })

  it('denies pending requests when the session stops or the call is aborted', async () => {
    const { broker, events } = setup()
    const a = broker.ask('s1', bash('a'))
    const b = broker.ask('s2', bash('b'))
    broker.cancelSession('s1')
    await expect(a).resolves.toMatchObject({ behavior: 'deny' })
    expect(broker.hasPending('s2')).toBe(true)

    const controller = new AbortController()
    const c = broker.ask('s2', bash('c'), controller.signal)
    controller.abort()
    await expect(c).resolves.toMatchObject({ behavior: 'deny' })
    expect(events.filter((e) => e.event.type === 'approval_resolved' && e.event.decision === 'cancelled')).toHaveLength(2)
    void b
  })

  it('drops session rules when the session is forgotten', async () => {
    const { broker, lastRequestId } = setup()
    const first = broker.ask('s1', { toolUseId: 't', toolName: 'Edit', input: { file_path: 'a' }, reason: '' })
    broker.answer('s1', lastRequestId(), 'allow-session')
    await first
    broker.forgetSession('s1')
    const spy = vi.fn()
    void broker.ask('s1', { toolUseId: 't', toolName: 'Edit', input: { file_path: 'b' }, reason: '' }).then(spy)
    expect(broker.hasPending('s1')).toBe(true)
  })
})

describe('sessionRuleFor', () => {
  it('scopes shell tools to the exact command', () => {
    expect(sessionRuleFor('Bash', { command: 'ls' })).toBe('Bash:ls')
    expect(sessionRuleFor('Edit', { file_path: 'a' })).toBe('Edit')
  })
})

describe('ApprovalBroker questions', () => {
  const pick = [{ question: 'Which database?', header: 'Storage', options: [{ label: 'SQLite', description: '' }, { label: 'Postgres', description: '' }], multiSelect: false }]
  const lastQuestionId = (events: Array<{ event: AgentEvent }>) => {
    const req = [...events].reverse().find((e) => e.event.type === 'question_request')
    return req && req.event.type === 'question_request' ? req.event.requestId : ''
  }

  it('waits for the answers and reports them', async () => {
    const { broker, events } = setup()
    const answers = broker.question('s1', 't1', pick)
    expect(broker.hasPending('s1')).toBe(true)
    expect(events[0]?.event).toMatchObject({ type: 'question_request', toolUseId: 't1', questions: pick })
    broker.answerQuestion('s1', lastQuestionId(events), { 'Which database?': 'SQLite' })
    await expect(answers).resolves.toEqual({ 'Which database?': 'SQLite' })
    expect(broker.hasPending('s1')).toBe(false)
    expect(events.at(-1)?.event).toMatchObject({ type: 'question_resolved', answers: { 'Which database?': 'SQLite' } })
  })

  it('resolves with null when skipped, cancelled or aborted', async () => {
    const { broker, events } = setup()
    const skipped = broker.question('s1', 't1', pick)
    broker.answerQuestion('s1', lastQuestionId(events), null)
    await expect(skipped).resolves.toBeNull()

    const stopped = broker.question('s1', 't2', pick)
    broker.cancelSession('s1')
    await expect(stopped).resolves.toBeNull()
    expect(events.at(-1)?.event).toMatchObject({ type: 'question_resolved', answers: null })

    const controller = new AbortController()
    const aborted = broker.question('s1', 't3', pick, controller.signal)
    controller.abort()
    await expect(aborted).resolves.toBeNull()
  })

  it('refuses answers from another session or given twice', () => {
    const { broker, events } = setup()
    void broker.question('s1', 't1', pick)
    const id = lastQuestionId(events)
    expect(() => broker.answerQuestion('s2', id, null)).toThrow()
    broker.answerQuestion('s1', id, null)
    expect(() => broker.answerQuestion('s1', id, null)).toThrow()
  })
})
