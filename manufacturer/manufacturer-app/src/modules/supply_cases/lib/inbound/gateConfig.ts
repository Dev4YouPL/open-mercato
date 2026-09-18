import { parseSenderAllowlist, type SenderAllowlist } from './senderAllowlist'

/**
 * Deployment-level bounds for the inbound transport gate. Kept out of the gate
 * itself so the decision stays a pure function of its inputs and every test can
 * state the policy it is exercising.
 */

export type InboundGateConfig = {
  allowedProviderKeys: ReadonlySet<string>
  senderAllowlist: SenderAllowlist
  maxBodyLength?: number
}

export const SENDER_ALLOWLIST_ENV_KEY = 'OM_SUPPLY_CASES_INBOUND_ALLOWLIST'
export const PROVIDER_KEYS_ENV_KEY = 'OM_SUPPLY_CASES_INBOUND_PROVIDERS'

/**
 * The demo deployment's supplier domain (`.ai/specs/2026-09-18-supplier-email-agent-workflow.md`).
 * It applies only when the deployment has not stated a policy at all; setting
 * the variable to an empty value is a deliberate "allow nobody" and is honoured
 * as such.
 */
export const DEFAULT_SENDER_ALLOWLIST = '@hackon-om-wro.cloud'

/** Only the IMAP mailbox is wired for this flow; every other channel is rejected. */
export const DEFAULT_PROVIDER_KEYS = 'imap'

type EnvSource = Record<string, string | undefined>

export function resolveInboundGateConfig(env: EnvSource = process.env): InboundGateConfig {
  const rawAllowlist = env[SENDER_ALLOWLIST_ENV_KEY]
  const rawProviders = env[PROVIDER_KEYS_ENV_KEY]

  return {
    allowedProviderKeys: parseProviderKeys(rawProviders === undefined ? DEFAULT_PROVIDER_KEYS : rawProviders),
    senderAllowlist: parseSenderAllowlist(rawAllowlist === undefined ? DEFAULT_SENDER_ALLOWLIST : rawAllowlist),
  }
}

function parseProviderKeys(raw: string): ReadonlySet<string> {
  return new Set(
    raw
      .split(/[\s,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  )
}
