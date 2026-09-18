import { createInboundSignalSchema, type InboundSignal } from '../../data/inbound-signal'
import type { InboundCandidate } from '../inbound/candidateList'
import { buildInboundTriageInput, type InboundTriageAgentInput } from './triageInput'

/**
 * The only supported way to run `supply_cases.inbound_triage_advisor`.
 *
 * Two things happen here that cannot happen at registration time. The input is
 * built from the candidate list rather than from anything the message said, and
 * the result is validated against `createInboundSignalSchema(candidates.length)`
 * — the per-run bound that closes the correlation set. The statically
 * registered schema validates shape only; with zero candidates offered, the
 * factory makes `EXISTING_CASE` unreachable by construction.
 *
 * The invoker is a port so the decision path is exercisable without an LLM, a
 * network or a database. This function performs no writes and has no repository
 * to write to: nothing about a failure here can change a case.
 */

export type InboundTriageInvoker = (input: InboundTriageAgentInput) => Promise<unknown>

export type InboundTriageFailureReason =
  /** The sanitized body carries no new statement; re-reading quoted history is exactly the wrong fix. */
  | 'EMPTY_BODY'
  /** No provider, a provider error, or a timeout. Never a fabricated result. */
  | 'AGENT_UNAVAILABLE'
  /** The result failed the closed contract, including a candidateIndex outside the offered list. */
  | 'SCHEMA_INVALID'

export type InboundTriageResult =
  | { ok: true; signal: InboundSignal; input: InboundTriageAgentInput }
  | { ok: false; reason: InboundTriageFailureReason; issues: readonly string[] }

export async function runInboundTriage(params: {
  sanitizedBody: string
  senderEmail: string
  candidates: readonly InboundCandidate[]
  invoke: InboundTriageInvoker
}): Promise<InboundTriageResult> {
  if (params.sanitizedBody.trim().length === 0) {
    return { ok: false, reason: 'EMPTY_BODY', issues: [] }
  }

  const input = buildInboundTriageInput({
    sanitizedBody: params.sanitizedBody,
    senderEmail: params.senderEmail,
    candidates: params.candidates,
  })

  let raw: unknown
  try {
    raw = await params.invoke(input)
  } catch (error) {
    return {
      ok: false,
      reason: 'AGENT_UNAVAILABLE',
      issues: [error instanceof Error ? error.message : String(error)],
    }
  }

  const parsed = createInboundSignalSchema(params.candidates.length).safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'SCHEMA_INVALID',
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
    }
  }

  return { ok: true, signal: parsed.data, input }
}
