/**
 * Removes quoted reply history and signature footers, leaving only the text the
 * sender wrote in THIS message.
 *
 * This is a correctness requirement before it is a cost one. The third message
 * in a supply thread quotes the first two, and the first two carry the
 * quantities and dates this message supersedes. A model shown the whole thread
 * extracts the superseded numbers with high confidence, which is the worst
 * failure available here: nothing errors, and a wrong quantity enters the
 * domain looking exactly like a right one.
 *
 * The removed text is never lost — callers persist the original body for audit.
 */

export type StripQuotedHistoryResult = {
  text: string
  removed: boolean
  matchedMarker: string | null
}

type Marker = {
  name: string
  pattern: RegExp
}

/**
 * Anchored per line so a marker phrase inside a normal sentence does not cut the
 * message. Polish variants are listed because both supplier mailboxes in this
 * deployment write Polish.
 */
const QUOTE_MARKERS: Marker[] = [
  { name: 'outlook-original-message', pattern: /^-{2,}\s*(original message|wiadomo[śs][ćc] oryginalna|pierwotna wiadomo[śs][ćc])\s*-{2,}$/i },
  { name: 'outlook-forwarded', pattern: /^-{2,}\s*(forwarded message|wiadomo[śs][ćc] przekazana)\s*-{2,}$/i },
  { name: 'outlook-rule', pattern: /^_{10,}$/ },
  { name: 'gmail-on-wrote', pattern: /^\s*(on|w dniu|dnia)\b.*\b(wrote|napisa[łl](?:\(a\))?|napisa[łl]a)\s*:\s*$/i },
  { name: 'header-block-from', pattern: /^\s*(from|od)\s*:\s*\S.*$/i },
  { name: 'quote-prefix', pattern: /^\s*>/ },
]

const FOOTER_MARKERS: Marker[] = [
  { name: 'rfc3676-signature', pattern: /^--\s?$/ },
  { name: 'mobile-signature', pattern: /^\s*(sent from my \w+|wys[łl]ane z mojego \w+|pobierz outlooka|get outlook for \w+)\b.*$/i },
]

/**
 * `From:` alone is too common in prose to cut on, so it only counts as a quote
 * header when the following lines look like the rest of a forwarded header
 * block.
 */
const HEADER_BLOCK_FOLLOWERS = /^\s*(sent|wys[łl]ano|data|date|to|do|subject|temat|cc|dw)\s*:/i

function isHeaderBlockStart(lines: string[], index: number): boolean {
  for (let offset = 1; offset <= 3; offset += 1) {
    const line = lines[index + offset]
    if (line === undefined) return false
    if (line.trim().length === 0) continue
    if (HEADER_BLOCK_FOLLOWERS.test(line)) return true
    return false
  }
  return false
}

function findCutIndex(lines: string[], markers: Marker[], requireHeaderBlock: boolean): { index: number; marker: string } | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    for (const marker of markers) {
      if (!marker.pattern.test(line)) continue
      if (marker.name === 'header-block-from') {
        if (!requireHeaderBlock || !isHeaderBlockStart(lines, index)) continue
      }
      return { index, marker: marker.name }
    }
  }
  return null
}

/**
 * When the cut would leave nothing, the result is deliberately empty rather than
 * silently falling back to the full body: a message that is only a quote carries
 * no new statement, and the caller quarantines it instead of extracting stale
 * numbers from the history.
 */
export function stripQuotedHistory(plainText: string): StripQuotedHistoryResult {
  const lines = plainText.replace(/\r\n?/g, '\n').split('\n')

  const quoteCut = findCutIndex(lines, QUOTE_MARKERS, true)
  const footerCut = findCutIndex(lines, FOOTER_MARKERS, false)

  const candidates = [quoteCut, footerCut].filter((cut): cut is { index: number; marker: string } => cut !== null)
  if (candidates.length === 0) {
    return { text: plainText.trim(), removed: false, matchedMarker: null }
  }

  const earliest = candidates.reduce((best, cut) => (cut.index < best.index ? cut : best))
  const kept = lines.slice(0, earliest.index).join('\n').replace(/\n{3,}/g, '\n\n').trim()

  return { text: kept, removed: true, matchedMarker: earliest.marker }
}
