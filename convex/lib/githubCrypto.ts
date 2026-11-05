import { ConvexError } from 'convex/values'

// AES-GCM encryption for GitHub credentials stored in Convex.
// Payload format: `v1.<base64 iv>.<base64 ciphertext>`.
const PAYLOAD_VERSION = 'v1'
const IV_BYTES = 12

export const TOKEN_ENCRYPTION_KEY_ENV = 'GITHUB_TOKEN_ENCRYPTION_KEY'

function configError(message: string) {
  return new ConvexError({ code: 'CONFIG_ERROR', message })
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export async function importEncryptionKey(secret: string) {
  let raw: Uint8Array<ArrayBuffer>
  try {
    raw = base64ToBytes(secret.trim())
  } catch {
    throw configError(`${TOKEN_ENCRYPTION_KEY_ENV} must be base64 encoded.`)
  }
  if (raw.length !== 32) {
    throw configError(
      `${TOKEN_ENCRYPTION_KEY_ENV} must decode to 32 bytes. Generate one with \`openssl rand -base64 32\`.`,
    )
  }
  return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function getEncryptionKey() {
  const secret = process.env[TOKEN_ENCRYPTION_KEY_ENV]
  if (!secret) {
    throw configError(
      `${TOKEN_ENCRYPTION_KEY_ENV} is missing. Set it with \`npx convex env set ${TOKEN_ENCRYPTION_KEY_ENV} "$(openssl rand -base64 32)"\`.`,
    )
  }
  return await importEncryptionKey(secret)
}

export async function encryptSecret(key: CryptoKey, plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return [PAYLOAD_VERSION, bytesToBase64(iv), bytesToBase64(new Uint8Array(ciphertext))].join('.')
}

export async function decryptSecret(key: CryptoKey, payload: string) {
  const [version, iv, ciphertext] = payload.split('.')
  if (version !== PAYLOAD_VERSION || !iv || !ciphertext) {
    throw configError('Stored GitHub credentials are unreadable. Add your GitHub token again.')
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(iv) },
      key,
      base64ToBytes(ciphertext),
    )
    return new TextDecoder().decode(plaintext)
  } catch {
    throw configError(
      `Stored GitHub credentials could not be decrypted. If ${TOKEN_ENCRYPTION_KEY_ENV} changed, add your GitHub token again.`,
    )
  }
}
