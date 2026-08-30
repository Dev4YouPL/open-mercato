import { z } from 'zod'

const MAX_CURSOR_BYTES = 512

const bomCursorSchema = z.object({
  v: z.literal(1),
  updatedAt: z.string(),
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  pageSize: z.number().int().min(1).max(100),
  filterDigest: z.string(),
})
export type BomCursor = z.infer<typeof bomCursorSchema>

const lineCursorSchema = z.object({
  v: z.literal(1),
  position: z.string(),
  id: z.string().uuid(),
  bomId: z.string().uuid(),
  revisionId: z.string().uuid(),
  revisionUpdatedAt: z.string(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  pageSize: z.number().int().min(1).max(100),
})
export type LineCursor = z.infer<typeof lineCursorSchema>

function encode(payload: unknown): string {
  const token = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  if (token.length > MAX_CURSOR_BYTES) {
    throw new Error('[internal] Cursor payload exceeds the maximum encoded size')
  }
  return token
}

function decode<T>(token: string, schema: z.ZodType<T>): T | null {
  if (!token || token.length > MAX_CURSOR_BYTES) return null
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    return schema.parse(JSON.parse(decoded))
  } catch {
    return null
  }
}

export function encodeBomCursor(payload: Omit<BomCursor, 'v'>): string {
  return encode({ v: 1, ...payload })
}

export function decodeBomCursor(token: string | undefined): BomCursor | null {
  if (!token) return null
  return decode(token, bomCursorSchema)
}

export function encodeLineCursor(payload: Omit<LineCursor, 'v'>): string {
  return encode({ v: 1, ...payload })
}

export function decodeLineCursor(token: string | undefined): LineCursor | null {
  if (!token) return null
  return decode(token, lineCursorSchema)
}

export function filterDigest(parts: Record<string, string | undefined | null>): string {
  const normalized = Object.keys(parts)
    .sort()
    .map((key) => `${key}=${parts[key] ?? ''}`)
    .join('&')
  let hash = 0
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}
