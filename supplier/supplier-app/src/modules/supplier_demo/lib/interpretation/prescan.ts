export type PreScanRule =
  | 'role_marker'
  | 'instruction_override'
  | 'schema_key'
  | 'fake_json_output'
  | 'base64_payload'
  | 'html_or_script'

export type PreScanResult = {
  hit: boolean
  rules: PreScanRule[]
}

function hasRoleMarker(value: string): boolean {
  return /(?:^|\s)(?:system|assistant|developer|user)\s*:/i.test(value) || /<\|[^|]{1,40}\|>|\[INST\]/i.test(value)
}

function hasInstructionOverride(value: string): boolean {
  return /\b(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+instructions\b/i.test(value)
    || /\b(?:zignoruj|pomiń|pomijaj|nie stosuj się do)\s+(?:wszystkie\s+)?(?:poprzednie|wcześniejsze|powyższe)\s+instrukcje\b/i.test(value)
}

function hasSchemaKey(value: string): boolean {
  return /["']?(?:optionId|reasonCodes|decision)["']?\s*:/i.test(value)
}

function hasFakeJsonOutput(value: string): boolean {
  return /```(?:json)?\s*[\s\S]*?(?:"(?:kind|tranches|confidence|instructionsDetected)"\s*:)[\s\S]*?```/i.test(value)
    || /\{\s*"(?:kind|tranches)"\s*:/i.test(value)
}

function hasBase64Payload(value: string): boolean {
  return /(?:^|[^A-Za-z0-9+/])[A-Za-z0-9+/]{200,}={0,2}(?:$|[^A-Za-z0-9+/])/m.test(value)
}

function hasHtmlOrScript(value: string): boolean {
  return /<\s*(?:script|style|iframe|html|body)\b[^>]*>|<\/?[A-Za-z][^>]{0,100}>/i.test(value)
}

export function preScanReplyText(value: string): PreScanResult {
  const rules: PreScanRule[] = []
  if (hasRoleMarker(value)) rules.push('role_marker')
  if (hasInstructionOverride(value)) rules.push('instruction_override')
  if (hasSchemaKey(value)) rules.push('schema_key')
  if (hasFakeJsonOutput(value)) rules.push('fake_json_output')
  if (hasBase64Payload(value)) rules.push('base64_payload')
  if (hasHtmlOrScript(value)) rules.push('html_or_script')
  return { hit: rules.length > 0, rules }
}

export const prescanReplyText = preScanReplyText
export const preScan = preScanReplyText
