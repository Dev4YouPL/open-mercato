type CustomerSnapshot = {
  customer?: {
    primaryEmail?: unknown
  }
}

export type RecipientResolution = {
  ok: true
  email: string
} | {
  ok: false
  reason: 'recipient_missing' | 'recipient_not_allowlisted'
}

function allowlistedEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function resolveSupplyRecipient(
  customerSnapshot: unknown,
  partnerEmails: string | undefined = process.env.SUPPLIER_DEMO_PARTNER_EMAILS,
): RecipientResolution {
  const snapshot = customerSnapshot as CustomerSnapshot | null | undefined
  const email = typeof snapshot?.customer?.primaryEmail === 'string'
    ? snapshot.customer.primaryEmail.trim()
    : ''
  if (!email) return { ok: false, reason: 'recipient_missing' }
  if (!allowlistedEmails(partnerEmails).has(email.toLowerCase())) {
    return { ok: false, reason: 'recipient_not_allowlisted' }
  }
  return { ok: true, email }
}

export const resolveRecipient = resolveSupplyRecipient
