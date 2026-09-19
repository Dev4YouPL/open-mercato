import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export type QaTestEnvDescriptor = {
  status?: string
  baseUrl?: string
  pid?: number
  credentials?: { email?: string; password?: string }
  supplyCases?: { dataDir?: string; tenantId?: string; organizationId?: string }
}

export type LiveMailRun = {
  runId: string
  subject: string
  inboundMessageId: string
  idempotencyKey: string
  reportDir: string
}

export type PreflightResult = {
  outcome: 'BLOCKED' | 'READY_FOR_LIVE'
  reasons: string[]
  descriptor: QaTestEnvDescriptor | null
  externalSideEffects: false
  dedicatedScope: boolean
}

export type MailSmokeResult = {
  command: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  outputSummary: string
  output: string
  headers: MailHeaders | null
}

export type MailHeaders = {
  uid: string | null
  from: string | null
  to: string | null
  subject: string | null
  messageId: string | null
}

const MAX_OUTPUT_BYTES = 16_384
const DEFAULT_COMMAND_TIMEOUT_MS = 135_000
const MAIL_HEADER_KEYS = ['uid', 'from', 'to', 'subject', 'message_id'] as const

export function isLiveMailApproved(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LIVE_MAIL_E2E === '1' && env.LIVE_MAIL_E2E_APPROVED === '1'
}

export function createLiveMailRun(repoRoot = process.cwd()): LiveMailRun {
  const suffix = randomUUID()
  const runId = `live-mail-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${suffix.slice(0, 8)}`
  return {
    runId,
    subject: `Supplier 1 proposal ${runId}`,
    inboundMessageId: `<${runId}@qa.invalid>`,
    idempotencyKey: `supply-cases-live-mail:${runId}`,
    reportDir: path.resolve(repoRoot, '.ai', 'runs', runId),
  }
}

export function readQaTestEnvDescriptor(repoRoot = process.cwd()): QaTestEnvDescriptor | null {
  try {
    const descriptorPath = path.resolve(repoRoot, '.ai', 'qa', 'test-env.json')
    const descriptor = readFileSync(descriptorPath, 'utf8')
    return JSON.parse(descriptor.replace(/^\uFEFF/, '')) as QaTestEnvDescriptor
  } catch {
    return null
  }
}

export function evaluateLiveMailPreflight(
  descriptor: QaTestEnvDescriptor | null,
  env: NodeJS.ProcessEnv = process.env,
): PreflightResult {
  const reasons: string[] = []
  const dedicatedScope = env.LIVE_MAIL_E2E_DEDICATED_SCOPE === '1'

  if (!isLiveMailApproved(env)) reasons.push('LIVE_MAIL_E2E=1 and LIVE_MAIL_E2E_APPROVED=1 are required')
  if (!descriptor) reasons.push('shared QA test-env descriptor is missing or invalid')
  if (descriptor && descriptor.status !== 'running') reasons.push('shared QA runtime is not marked running')
  if (descriptor && (!descriptor.pid || descriptor.pid <= 0)) reasons.push('shared QA runtime PID is missing')
  if (descriptor && !descriptor.baseUrl) reasons.push('shared QA runtime base URL is missing')
  if (descriptor && !descriptor.supplyCases?.dataDir) reasons.push('supply_cases data directory is missing')
  if (descriptor && !descriptor.supplyCases?.tenantId) reasons.push('supply_cases tenant id is missing')
  if (descriptor && !descriptor.supplyCases?.organizationId) reasons.push('supply_cases organization id is missing')
  if (isLiveMailApproved(env) && !dedicatedScope) reasons.push('LIVE_MAIL_E2E_DEDICATED_SCOPE=1 is required for destructive local cleanup')

  return {
    outcome: reasons.length === 0 ? 'READY_FOR_LIVE' : 'BLOCKED',
    reasons,
    descriptor,
    externalSideEffects: false,
    dedicatedScope,
  }
}

export function buildMailSmokeCommand(
  command: 'check-config' | 'send-inbound' | 'list-mail' | 'wait-for-mail',
  args: readonly string[] = [],
  executable = 'python',
): { executable: string; args: string[]; redacted: string } {
  const fullArgs = ['scripts/mail-smoke.py', command, ...args]
  const redactedArgs = fullArgs.map((value, index) => {
    const previous = fullArgs[index - 1]
    return previous === '--body' || previous === '--password' || previous === '--token' ? '<redacted>' : value
  })
  return {
    executable,
    args: fullArgs,
    redacted: [executable, ...redactedArgs].join(' '),
  }
}

export async function runMailSmoke(
  repoRoot: string,
  command: 'check-config' | 'send-inbound' | 'list-mail' | 'wait-for-mail',
  args: readonly string[],
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
): Promise<MailSmokeResult> {
  const executable = process.env.PYTHON_EXECUTABLE?.trim() || 'python'
  const built = buildMailSmokeCommand(command, args, executable)
  const startedAt = Date.now()
  const child = spawn(built.executable, built.args, {
    cwd: repoRoot,
    env: process.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output: Buffer[] = []
  const errors: Buffer[] = []
  let timedOut = false
  let settled = false
  const appendBounded = (target: Buffer[], chunk: Buffer) => {
    const current = Buffer.concat(target)
    if (current.length >= MAX_OUTPUT_BYTES) return
    target.push(chunk.subarray(0, MAX_OUTPUT_BYTES - current.length))
  }
  child.stdout.on('data', (chunk: Buffer) => appendBounded(output, chunk))
  child.stderr.on('data', (chunk: Buffer) => appendBounded(errors, chunk))

  const result = await new Promise<{ exitCode: number | null }>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
      resolve({ exitCode: null })
    }, timeoutMs)
    child.once('error', () => {
      clearTimeout(timer)
      resolve({ exitCode: null })
    })
    child.once('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode })
    })
  })

  const stdout = Buffer.concat(output).toString('utf8')
  const stderrBytes = Buffer.concat(errors).byteLength
  return {
    command: built.redacted,
    exitCode: result.exitCode,
    timedOut,
    durationMs: Date.now() - startedAt,
    outputSummary: `stdoutBytes=${Buffer.byteLength(stdout, 'utf8')} stderrBytes=${stderrBytes}`,
    output: stdout,
    headers: command === 'wait-for-mail' && result.exitCode === 0 ? parseMailHeaders(stdout) : null,
  }
}

export function parseMailHeaders(output: string): MailHeaders {
  const values: Partial<Record<typeof MAIL_HEADER_KEYS[number], string>> = {}
  const pattern = new RegExp(`(?:^|\\s)(${MAIL_HEADER_KEYS.join('|')})=([\\s\\S]*?)(?=\\s(?:${MAIL_HEADER_KEYS.join('|')})=|$)`, 'g')
  for (const match of output.matchAll(pattern)) values[match[1] as typeof MAIL_HEADER_KEYS[number]] = match[2].trim()
  return {
    uid: values.uid ?? null,
    from: values.from ?? null,
    to: values.to ?? null,
    subject: values.subject ?? null,
    messageId: values.message_id ?? null,
  }
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/(password|token|secret|authorization|api[_-]?key)=\S+/gi, '$1=<redacted>')
    .replace(/(--body\s+)\S+/gi, '$1<redacted>')
}

export async function writeLiveMailReport(reportDir: string, report: Record<string, unknown>): Promise<void> {
  await mkdir(reportDir, { recursive: true })
  await writeFile(path.join(reportDir, 'REPORT.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  const markdown = [
    '# Supply cases live-mail browser E2E',
    '',
    `- Outcome: ${String(report.outcome ?? 'UNKNOWN')}`,
    `- External side effects: ${String(report.externalSideEffects ?? 'unknown')}`,
    `- Run id: ${String(report.runId ?? 'unknown')}`,
    '',
    'The JSON report contains the redacted command and bounded evidence summary.',
    '',
  ].join('\n')
  await writeFile(path.join(reportDir, 'REPORT.md'), markdown, 'utf8')
}
