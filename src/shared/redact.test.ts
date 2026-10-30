import { describe, expect, it } from 'vitest'
import { redact, redactArgs } from './redact'

describe('redact', () => {
  it('masks Anthropic and OpenAI style keys', () => {
    expect(redact('key sk-ant-api03-abcdefghijklmnop end')).toBe('key sk-ant-*** end')
    expect(redact('sk-proj-ABCDEFGHIJKLMNOPQRST')).toBe('sk-***')
  })

  it('masks bearer tokens and key=value pairs', () => {
    expect(redact('Authorization: Bearer abc.def.ghijkl')).toBe('Authorization: ***')
    expect(redact('Authorization: Basic dXNlcjpwYXNz')).toBe('Authorization: ***')
    expect(redact('sent with bearer abcdefghijkl')).toBe('sent with bearer ***')
    expect(redact('{"apiKey":"hunter22value"}')).toBe('{"apiKey":"***"}')
    expect(redact('token=0123456789')).toBe('token=***')
  })

  it('leaves ordinary text alone', () => {
    const text = 'opened workspace C:/repo/src with 12 files'
    expect(redact(text)).toBe(text)
  })

  it('masks secret values in command arguments', () => {
    expect(redactArgs(['gh-mcp', '--token', 'abc123def', '--repo', 'me/x', '--api-key=zzzzzz'])).toEqual(['gh-mcp', '--token', '***', '--repo', 'me/x', '--api-key=***'])
    expect(redact('ghp_abcdefghijklmnop')).toBe('ghp_***')
  })
})
