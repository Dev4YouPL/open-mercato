import type { StoreScope, SupplyCasesStore } from '../../data/repositories'
import type { InboundMessage } from '../../data/types'
import { buildCandidateList, type CandidateList, type InboundCandidate } from './candidateList'
import { resolveThreadEvidence, selectResumableMatch, type ThreadEvidence, type ThreadMatch } from './resolveThread'

/**
 * Assembles, from scoped records alone, everything the triage step is allowed
 * to work from for one inbound message.
 *
 * This is the store-facing half of the input. It still carries `caseId` and the
 * full thread evidence, which the module needs and the agent must never see —
 * `lib/triage/triageInput.ts` narrows it to the agent-facing projection.
 *
 * Nothing here reads the body. The sender comes from the persisted envelope
 * snapshot and the reply chain from the persisted headers, both written by the
 * transport gate before any of this ran, so the context cannot be widened by
 * what the message says.
 */

export type TriageContext = {
  inboundMessageId: string
  rfcMessageId: string
  senderEmail: string
  /** The author's new text, quoted history removed. The only body that travels on. */
  sanitizedBody: string
  candidates: InboundCandidate[]
  threadEvidence: ThreadEvidence
  /** Thread hits on cases this sender cannot reach; audit evidence only. */
  unreachableThreadMatches: ThreadMatch[]
  /**
   * The still-current message this reply answers, when the chain resolved to
   * one. A reply to a superseded request resolves to `null`, which is what
   * stops a stale offer from resuming a newer wait.
   */
  resumableMatch: ThreadMatch | null
}

export type AssembleTriageContextResult =
  | { ok: true; input: TriageContext }
  | { ok: false; reason: 'NO_SANITIZED_BODY' }

export async function assembleTriageContext(
  store: SupplyCasesStore,
  scope: StoreScope,
  message: InboundMessage,
): Promise<AssembleTriageContextResult> {
  // A message the gate accepted always has one; a fixture or a future intake
  // path might not, and an agent asked to classify nothing would invent
  // something to say.
  if (!message.sanitizedBody) return { ok: false, reason: 'NO_SANITIZED_BODY' }

  const [cases, correlations] = await Promise.all([store.supplyCases.list(scope), store.outboundCorrelations.list(scope)])

  const threadEvidence = resolveThreadEvidence({
    inReplyTo: message.inReplyTo,
    references: message.references,
    correlations,
  })

  const candidateList: CandidateList = buildCandidateList({
    cases,
    senderEmail: message.senderEmail,
    threadEvidence,
  })

  return {
    ok: true,
    input: {
      inboundMessageId: message.id,
      rfcMessageId: message.rfcMessageId,
      senderEmail: message.senderEmail,
      sanitizedBody: message.sanitizedBody,
      candidates: candidateList.candidates,
      threadEvidence,
      unreachableThreadMatches: candidateList.unreachableThreadMatches,
      resumableMatch: resolveReachableResumableMatch(threadEvidence, candidateList),
    },
  }
}

/**
 * A resumable match must satisfy BOTH halves of the guarantee: the request is
 * still current, and its case is one this sender may reach. Checking only the
 * first would let a reply from a non-participant resume a wait on a case that
 * was deliberately kept out of its candidate list.
 */
function resolveReachableResumableMatch(evidence: ThreadEvidence, candidateList: CandidateList): ThreadMatch | null {
  const resumable = selectResumableMatch(evidence)
  if (!resumable) return null
  const reachable = candidateList.candidates.some((candidate) => candidate.caseId === resumable.caseId)
  return reachable ? resumable : null
}
