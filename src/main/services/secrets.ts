import { t } from '@shared/i18n'
import { safeStorage } from 'electron'
import { AppError } from '@shared/errors'
import type { Db } from './db/database'

export interface Cipher {
  /** False when the OS offers no real encryption, e.g. Linux without a keyring. */
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

/**
 * Electron safeStorage: DPAPI on Windows, Keychain on macOS, the secret service on Linux.
 * Linux's `basic_text` fallback is a hardcoded key, so it counts as unavailable.
 */
export const safeStorageCipher: Cipher = {
  available: () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (data) => safeStorage.decryptString(data)
}

/** Encrypted values per profile. Plain text exists only in memory, in main, while a provider needs it. */
export class SecretsService {
  constructor(
    private readonly db: Db,
    private readonly cipher: Cipher
  ) {}

  available(): boolean {
    return this.cipher.available()
  }

  set(profileId: string, name: string, value: string): void {
    if (!this.cipher.available()) {
      throw new AppError(
        'secrets_unavailable',
        t('This system has no secure storage for secrets, so the key was not saved. On Linux, install and unlock a keyring (GNOME Keyring or KWallet).')
      )
    }
    this.db
      .prepare(
        `INSERT INTO secrets (profile_id, name, ciphertext, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(profile_id, name) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`
      )
      .run(profileId, name, this.cipher.encrypt(value), Date.now())
  }

  has(profileId: string, name: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM secrets WHERE profile_id = ? AND name = ?').get(profileId, name)
  }

  get(profileId: string, name: string): string | null {
    const row = this.db
      .prepare('SELECT ciphertext FROM secrets WHERE profile_id = ? AND name = ?')
      .get(profileId, name) as { ciphertext: Buffer } | undefined
    if (!row) return null
    try {
      return this.cipher.decrypt(row.ciphertext)
    } catch {
      throw new AppError(
        'secrets_unavailable',
        t('A stored key could not be decrypted. It may have been saved under another Windows account; enter it again.')
      )
    }
  }

  delete(profileId: string, name: string): void {
    this.db.prepare('DELETE FROM secrets WHERE profile_id = ? AND name = ?').run(profileId, name)
  }
}
