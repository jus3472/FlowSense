import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { parseCustomPracticeInput, type CustomPracticeInput } from '@/lib/practice/custom'

export const CUSTOM_HANDOFF_VERSION = 1
export const CUSTOM_HANDOFF_TTL_SECONDS = 5 * 60
export const CUSTOM_HANDOFF_COOKIE_VALUE_MAX_BYTES = 3_500
export const CUSTOM_HANDOFF_HEADER = 'x-flowsense-custom-session'

const IV_BYTES = 12
const TAG_BYTES = 16
const CLOCK_SKEW_MS = 30_000
const AAD = Buffer.from('flowsense/custom-handoff/v1', 'utf8')

interface CustomHandoffPayload {
  version: typeof CUSTOM_HANDOFF_VERSION
  userId: string
  issuedAt: number
  expiresAt: number
  practice: CustomPracticeInput
}

interface SealOptions {
  now?: number
  iv?: Uint8Array
}

interface OpenOptions {
  now?: number
}

export interface CustomHandoffResolution {
  clearCookie: boolean
  headerValue: string | null
}

function key(secret: string): Buffer {
  return createHash('sha256').update(AAD).update(secret, 'utf8').digest()
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url')
}

function parseBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    return Buffer.from(value, 'base64url')
  } catch {
    return null
  }
}

/**
 * Encrypts the private handoff and authenticates its user and expiry metadata.
 * The application secret is supplied only by server modules.
 */
export function sealCustomPracticeHandoff(
  practice: CustomPracticeInput,
  userId: string,
  secret: string,
  options: SealOptions = {},
): string | null {
  const checkedPractice = parseCustomPracticeInput(practice)
  if (!checkedPractice || !userId || !secret) return null
  const issuedAt = options.now ?? Date.now()
  const payload: CustomHandoffPayload = {
    version: CUSTOM_HANDOFF_VERSION,
    userId,
    issuedAt,
    expiresAt: issuedAt + CUSTOM_HANDOFF_TTL_SECONDS * 1_000,
    practice: checkedPractice,
  }
  const iv = Buffer.from(options.iv ?? randomBytes(IV_BYTES))
  if (iv.byteLength !== IV_BYTES) return null
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  cipher.setAAD(AAD)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  const token = [
    String(CUSTOM_HANDOFF_VERSION),
    base64Url(iv),
    base64Url(encrypted),
    base64Url(cipher.getAuthTag()),
  ].join('.')
  return Buffer.byteLength(token, 'utf8') <= CUSTOM_HANDOFF_COOKIE_VALUE_MAX_BYTES ? token : null
}

/** Returns null for malformed, tampered, expired, or differently owned payloads. */
export function openCustomPracticeHandoff(
  token: string | undefined,
  userId: string,
  secret: string,
  options: OpenOptions = {},
): CustomPracticeInput | null {
  if (
    !token ||
    !userId ||
    !secret ||
    Buffer.byteLength(token, 'utf8') > CUSTOM_HANDOFF_COOKIE_VALUE_MAX_BYTES
  )
    return null
  const [version, rawIv, rawEncrypted, rawTag, ...extra] = token.split('.')
  if (
    version !== String(CUSTOM_HANDOFF_VERSION) ||
    !rawIv ||
    !rawEncrypted ||
    !rawTag ||
    extra.length > 0
  )
    return null
  const iv = parseBase64Url(rawIv)
  const encrypted = parseBase64Url(rawEncrypted)
  const tag = parseBase64Url(rawTag)
  if (!iv || iv.byteLength !== IV_BYTES || !encrypted || !tag || tag.byteLength !== TAG_BYTES)
    return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(secret), iv)
    decipher.setAAD(AAD)
    decipher.setAuthTag(tag)
    const rawPayload = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
      'utf8',
    )
    const payload = JSON.parse(rawPayload) as Partial<CustomHandoffPayload>
    const now = options.now ?? Date.now()
    if (
      payload.version !== CUSTOM_HANDOFF_VERSION ||
      payload.userId !== userId ||
      !Number.isInteger(payload.issuedAt) ||
      !Number.isInteger(payload.expiresAt) ||
      typeof payload.issuedAt !== 'number' ||
      typeof payload.expiresAt !== 'number' ||
      payload.issuedAt > now + CLOCK_SKEW_MS ||
      payload.expiresAt <= now ||
      payload.expiresAt - payload.issuedAt !== CUSTOM_HANDOFF_TTL_SECONDS * 1_000
    )
      return null
    return parseCustomPracticeInput(payload.practice)
  } catch {
    return null
  }
}

/** This value is forwarded upstream by Proxy and is never sent as a response header. */
export function serializeCustomPracticeHeader(practice: CustomPracticeInput): string {
  return Buffer.from(JSON.stringify(practice), 'utf8').toString('base64url')
}

export function parseCustomPracticeHeader(value: string | null): CustomPracticeInput | null {
  if (!value || Buffer.byteLength(value, 'utf8') > CUSTOM_HANDOFF_COOKIE_VALUE_MAX_BYTES)
    return null
  const decoded = parseBase64Url(value)
  if (!decoded) return null
  try {
    return parseCustomPracticeInput(JSON.parse(decoded.toString('utf8')) as unknown)
  } catch {
    return null
  }
}

/**
 * Proxy uses the deletion response as the one-time consumption boundary. A
 * later refresh has no cookie to resolve, while invalid payloads are cleared too.
 */
export function resolveCustomPracticeHandoff(
  cookieValue: string | undefined,
  userId: string | null,
  secret: string,
  options: OpenOptions = {},
): CustomHandoffResolution {
  const practice = userId ? openCustomPracticeHandoff(cookieValue, userId, secret, options) : null
  return {
    clearCookie: Boolean(cookieValue),
    headerValue: practice ? serializeCustomPracticeHeader(practice) : null,
  }
}
