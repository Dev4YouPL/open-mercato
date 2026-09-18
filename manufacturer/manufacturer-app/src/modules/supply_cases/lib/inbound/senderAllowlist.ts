import { normalizeEmail } from '../email/normalizeEmail'

/**
 * Which envelope senders may open work in this module. The list is compared
 * against the authenticated envelope address only — an address written in the
 * message text authorizes nothing.
 */

export type SenderAllowlist = {
  addresses: ReadonlySet<string>
  domains: ReadonlySet<string>
}

export const EMPTY_SENDER_ALLOWLIST: SenderAllowlist = {
  addresses: new Set<string>(),
  domains: new Set<string>(),
}

const ENTRY_SEPARATOR = /[\s,;]+/

/**
 * Accepts `user@example.com` for a single mailbox and `@example.com` for a whole
 * domain. An entry that does not normalize is dropped rather than kept as a raw
 * string: a half-parsed address that matched loosely would widen the list,
 * which is the one direction this check must never fail in.
 */
export function parseSenderAllowlist(raw: string | null | undefined): SenderAllowlist {
  const addresses = new Set<string>()
  const domains = new Set<string>()
  if (!raw) return { addresses, domains }

  for (const entry of raw.split(ENTRY_SEPARATOR)) {
    const trimmed = entry.trim()
    if (trimmed.length === 0) continue

    if (trimmed.startsWith('@')) {
      const domain = trimmed.slice(1).toLowerCase()
      if (domain.length > 0 && domain.includes('.')) domains.add(domain)
      continue
    }

    const normalized = normalizeEmail(trimmed)
    if (normalized.ok) addresses.add(normalized.address)
  }

  return { addresses, domains }
}

/**
 * Fails closed in every uncertain case: an empty list allows nobody, and a
 * sender whose address does not normalize never matches, not even an identical
 * literal entry.
 */
export function isSenderAllowed(allowlist: SenderAllowlist, senderEmail: string | null | undefined): boolean {
  const normalized = normalizeEmail(senderEmail)
  if (!normalized.ok) return false
  if (allowlist.addresses.has(normalized.address)) return true
  return allowlist.domains.has(normalized.domain)
}
