import { t } from '@shared/i18n'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { AppError } from '@shared/errors'
import { DEFAULT_OLLAMA_URL, type ApiProfileKind, type ConnectionResult } from '@shared/profiles'
import type { ChatAdapter } from './chat'
import { AnthropicAdapter } from './anthropic'
import { OpenAICompatAdapter } from './openai-compat'

export interface ApiTarget {
  kind: ApiProfileKind
  apiKey: string | null
  baseUrl: string
}

const ANTHROPIC_URL = 'https://api.anthropic.com'
/** Gemini's OpenAI-compatible endpoint (ai.google.dev/gemini-api/docs/openai). */
export const GEMINI_OPENAI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'

/**
 * Builds the adapter for one profile. Key and URL are always passed explicitly so the SDKs
 * never fall back to environment variables or credential files that belong to someone else.
 */
export function createAdapter(target: ApiTarget, fetch: typeof globalThis.fetch): ChatAdapter {
  const common = { fetch, maxRetries: 2, timeout: 10 * 60_000 }
  const key = () => {
    if (!target.apiKey) throw new AppError('invalid_request', t('This account has no API key'))
    return target.apiKey
  }
  switch (target.kind) {
    case 'anthropic':
      return new AnthropicAdapter(new Anthropic({ ...common, apiKey: key(), authToken: null, baseURL: ANTHROPIC_URL }))
    case 'openai':
      return new OpenAICompatAdapter(
        new OpenAI({ ...common, apiKey: key(), baseURL: 'https://api.openai.com/v1', organization: null, project: null }),
        'openai'
      )
    case 'gemini':
      return new OpenAICompatAdapter(
        new OpenAI({ ...common, apiKey: key(), baseURL: GEMINI_OPENAI_URL, organization: null, project: null }),
        'gemini'
      )
    case 'ollama':
      // Ollama ignores the key, but the SDK requires one.
      return new OpenAICompatAdapter(
        new OpenAI({ ...common, apiKey: 'ollama', baseURL: `${target.baseUrl || DEFAULT_OLLAMA_URL}/v1` }),
        'ollama'
      )
  }
}

/** Turns SDK and network errors into a sentence for the profile card or the chat. */
export function describeApiError(err: unknown, target: Pick<ApiTarget, 'kind' | 'baseUrl'>): string {
  const e = err as { status?: number; message?: string; name?: string; error?: { message?: string } }
  const vendor = target.kind === 'ollama' ? t('Ollama at {url}', { url: target.baseUrl || DEFAULT_OLLAMA_URL }) : t('the API')
  if (e?.name === 'APIConnectionError' || e?.name === 'APIConnectionTimeoutError') {
    return target.kind === 'ollama'
      ? t('Could not reach {vendor}. Is Ollama running?', { vendor })
      : t('Could not reach {vendor}: {message}', { vendor, message: e.message ?? t('network error') })
  }
  if (e?.status === 401) return t('The API key was rejected (401).')
  if (e?.status === 403) return t('The API key is not allowed to do this (403).')
  if (e?.status === 404) return t('{vendor} answered 404: {message}', { vendor, message: e.error?.message ?? e.message ?? t('not found') })
  if (e?.status === 429) return t('Rate limited or out of credits (429). Wait, or use another account.')
  if (e?.status && e.status >= 500) return t('{vendor} had an error ({status}). Try again in a moment.', { vendor, status: e.status })
  return e?.message ?? String(err)
}

/** "Test connection" for API accounts: listing the models proves the key and the URL. */
export async function testApiConnection(adapter: ChatAdapter, target: ApiTarget): Promise<ConnectionResult> {
  const result: ConnectionResult = {
    ok: false,
    status: t('Not connected'),
    detail: null,
    email: null,
    organization: null,
    subscriptionType: null,
    models: [],
    checkedAt: Date.now()
  }
  try {
    result.models = await adapter.listModels()
  } catch (err) {
    const status = (err as { status?: number }).status
    result.status = status === 401 || status === 403 ? t('Key rejected') : t('Not connected')
    result.detail = describeApiError(err, target)
    return result
  }
  result.ok = true
  result.status = 'Connected'
  if (result.models.length === 0) {
    result.detail = target.kind === 'ollama' ? t('No models yet. Pull one with `ollama pull <model>`.') : t('No chat models found.')
  }
  return result
}
