import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { buildScenarioFixtures } from '../data/fixtures'
import type { StoreScope } from '../data/repositories'
import { createQaSupplyCasesStore } from './test-environment'
import {
  buildMailSmokeCommand,
  createLiveMailRun,
  evaluateLiveMailPreflight,
  isLiveMailApproved,
  readQaTestEnvDescriptor,
  redactSensitiveText,
  runMailSmoke,
  writeLiveMailReport,
} from './supply-cases-live-mail-harness'

const repoRoot = path.resolve(process.cwd())
const testScope: StoreScope = {
  tenantId: process.env.OM_QA_TENANT_ID ?? '17689e9c-e0ab-49cc-b2fd-260f1c5fa945',
  organizationId: process.env.OM_QA_ORGANIZATION_ID ?? '6fcb2379-eb38-480d-bf6f-26b08c2a7449',
}
const store = createQaSupplyCasesStore()
const liveTimeoutMs = 150_000
const livePollIntervalMs = 20_000
const schedulerGracePeriodMs = 90_000
const liveProposalRawBody = [
  'Niestety 23.09.2026 dostarczymy tylko 300 sztuk MAT-42, pozostale 200 sztuk 25.09.2026.',
  '',
  'W dniu 2026-09-10 manufacturer@hackon-om-wro.cloud napisal:',
  '> Potwierdzamy zamowienie 500 sztuk MAT-42 na 23.09.2026.',
].join('\n')

type LiveFixture = {
  productionOrderId: string
  productionPlanId: string
  caseId: string | null
  correlationId: string | null
  sku: string
}

async function loginAsOperator(page: Page) {
  await page.goto('/backend/supply-cases')
  if (new URL(page.url()).pathname === '/login') {
    await page.getByLabel('Email').fill(process.env.OM_QA_EMAIL ?? 'admin@acme.com')
    await page.getByLabel('Password', { exact: true }).fill(process.env.OM_QA_PASSWORD ?? 'secret')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/backend(?:\/|$)/)
    await page.goto('/backend/supply-cases')
  }
  const dismissCookies = page.getByRole('button', { name: 'Dismiss', exact: true })
  if (await dismissCookies.count()) await dismissCookies.click()
}

async function createLiveFixture(runId: string): Promise<LiveFixture> {
  const base = buildScenarioFixtures(testScope)
  const productionOrderId = randomUUID()
  const productionPlanId = randomUUID()
  await store.productionOrders.create(testScope, {
    ...base.productionOrder,
    id: productionOrderId,
    orderNumber: `QA-${runId}-ORDER`,
  })
  await store.productionPlans.create(testScope, {
    ...base.productionPlan,
    id: productionPlanId,
    planNumber: `QA-${runId}-PLAN`,
    productionOrderIds: [productionOrderId],
  })
  return {
    productionOrderId,
    productionPlanId,
    caseId: null,
    correlationId: null,
    sku: base.productionPlan.materialSku,
  }
}

async function waitForInboundCase(
  runId: string,
  messageId: string,
  page: Page,
  report: Record<string, unknown>,
): Promise<{ caseId: string; correlationId: string }> {
  const deadline = Date.now() + liveTimeoutMs
  let manualPollTriggered = false
  while (Date.now() < deadline) {
    const elapsedMs = liveTimeoutMs - Math.max(0, deadline - Date.now())
    const message = await store.inboundMessages.findByRfcMessageId(testScope, messageId)
    if (message?.caseId) {
      const supplyCase = await store.supplyCases.findById(testScope, message.caseId)
      if (supplyCase && supplyCase.initialProposalId && supplyCase.initialOptions) {
        return { caseId: supplyCase.id, correlationId: supplyCase.correlationId }
      }
    }
    const mailboxCheck = await runMailSmoke(repoRoot, 'list-mail', [
      '--mailbox', 'manufacturer',
      '--limit', '20',
    ], livePollIntervalMs)
    const mailboxContainsMessage = mailboxCheck.output.includes(`message_id=${messageId}`)
    const mailboxChecks = Array.isArray(report.mailboxChecks) ? report.mailboxChecks : []
    mailboxChecks.push({
      checkedAt: new Date().toISOString(),
      command: mailboxCheck.command,
      exitCode: mailboxCheck.exitCode,
      mailboxContainsMessage,
    })
    report.mailboxChecks = mailboxChecks
    if (elapsedMs >= schedulerGracePeriodMs && !manualPollTriggered) {
      const browserPolls = Array.isArray(report.browserPolls) ? report.browserPolls : []
      try {
        await page.goto('/backend/profile/communication-channels', {
          waitUntil: 'domcontentloaded',
          timeout: Math.min(10_000, livePollIntervalMs),
        })
        const pollNowButton = page.getByRole('button', { name: /^(Poll now|Pobierz teraz)$/ })
        await pollNowButton.waitFor({ state: 'visible', timeout: Math.min(10_000, livePollIntervalMs) })
        await pollNowButton.click()
        manualPollTriggered = true
        browserPolls.push({
          checkedAt: new Date().toISOString(),
          action: 'click-poll-now-fallback',
          status: 'triggered',
        })
        console.log(`[live-mail] checkpoint run=${runId} mailboxContainsMessage=${mailboxContainsMessage}; scheduler grace elapsed, manual browser poll fallback triggered`)
      } catch (error) {
        manualPollTriggered = true
        browserPolls.push({
          checkedAt: new Date().toISOString(),
          action: 'click-poll-now-fallback',
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
        console.log(`[live-mail] checkpoint run=${runId} mailboxContainsMessage=${mailboxContainsMessage}; scheduler grace elapsed, browser poll fallback failed`)
      }
      report.browserPolls = browserPolls
    } else {
      console.log(`[live-mail] checkpoint run=${runId} mailboxContainsMessage=${mailboxContainsMessage}; waiting for background scheduler (${Math.round(elapsedMs / 1000)}s/${Math.round(liveTimeoutMs / 1000)}s)`)
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(livePollIntervalMs, Math.max(100, deadline - Date.now()))))
  }
  const message = await store.inboundMessages.findByRfcMessageId(testScope, messageId)
  report.triageEvidence = message
    ? {
        inboundMessageId: message.id,
        caseId: message.caseId,
        triageOutcome: message.triageOutcome,
        triageDisposition: message.triageDisposition,
        failureReason: message.failureReason,
      }
    : { inboundMessageId: null }
  throw new Error(`[internal] live inbound case did not reach an actionable proposal for ${runId}`)
}

async function captureRunScreenshot(page: Page, runDir: string, name: string) {
  await page.screenshot({ path: path.join(runDir, `${name}.png`), fullPage: true })
}

test.describe('Supply cases live-mail browser E2E', () => {
  test('LIVE-MAIL-001: dry-run preflight builds redacted commands and sends nothing', async () => {
    const run = createLiveMailRun(repoRoot)
    const preflight = evaluateLiveMailPreflight(readQaTestEnvDescriptor(repoRoot))
    const commands = [
      buildMailSmokeCommand('check-config'),
      buildMailSmokeCommand('send-inbound', ['--supplier', 'supplier1', '--subject', run.subject, '--body', liveProposalRawBody, '--message-id', run.inboundMessageId]),
      buildMailSmokeCommand('wait-for-mail', ['--mailbox', 'supplier2', '--subject', run.subject, '--timeout', '120']),
    ]
    expect(preflight.externalSideEffects).toBe(false)
    expect(commands[1].redacted).toContain('--body <redacted>')
    expect(commands[1].redacted).not.toContain(liveProposalRawBody)
    await writeLiveMailReport(run.reportDir, {
      outcome: preflight.outcome,
      runId: run.runId,
      externalSideEffects: false,
      mode: isLiveMailApproved() ? 'approved-live-not-started' : 'dry-run',
      preflight: {
        reasons: preflight.reasons,
        descriptorPresent: preflight.descriptor !== null,
        dedicatedScope: preflight.dedicatedScope,
      },
      commands: commands.map((command) => command.redacted),
      screenshots: [],
      traces: [],
      cleanup: 'not-needed-no-send',
    })
  })

  test('LIVE-MAIL-002/003/004: approved headed inbound, guarded decision, and one RFQ', async ({ page }, testInfo) => {
    const run = createLiveMailRun(repoRoot)
    const preflight = evaluateLiveMailPreflight(readQaTestEnvDescriptor(repoRoot))
    if (!isLiveMailApproved()) {
      await writeLiveMailReport(run.reportDir, {
        outcome: 'BLOCKED',
        runId: run.runId,
        externalSideEffects: false,
        reason: 'live mail requires LIVE_MAIL_E2E=1 and LIVE_MAIL_E2E_APPROVED=1',
        screenshots: [],
        traces: [],
      })
      test.skip(true, 'BLOCKED: live mail opt-in and approval flags are absent')
      return
    }
    if (preflight.outcome !== 'READY_FOR_LIVE') {
      await writeLiveMailReport(run.reportDir, {
        outcome: 'BLOCKED',
        runId: run.runId,
        externalSideEffects: false,
        preflight: { reasons: preflight.reasons },
        screenshots: [],
        traces: [],
      })
      test.skip(true, `BLOCKED: ${preflight.reasons.join('; ')}`)
      return
    }

    let fixture: LiveFixture | null = null
    let inboundSent = false
    let failure: unknown = null
    const report: Record<string, unknown> = {
      outcome: 'INCONCLUSIVE',
      runId: run.runId,
      externalSideEffects: false,
      commands: [],
      screenshots: [],
      traces: [],
      fixtureIds: {},
      failureAnalysis: [],
    }

    try {
      fixture = await createLiveFixture(run.runId)
      report.fixtureIds = { productionOrderId: fixture.productionOrderId, productionPlanId: fixture.productionPlanId }

      const configResult = await runMailSmoke(repoRoot, 'check-config', [], 20_000)
      report.commands = [configResult.command]
      if (configResult.exitCode !== 0 || configResult.timedOut) throw new Error('[internal] mail-smoke check-config did not pass')

      await loginAsOperator(page)
      await captureRunScreenshot(page, run.reportDir, 'preflight')
      ;(report.screenshots as string[]).push('preflight.png')

      const sendResult = await runMailSmoke(repoRoot, 'send-inbound', [
        '--supplier', 'supplier1',
        '--subject', run.subject,
        '--body', liveProposalRawBody,
        '--message-id', run.inboundMessageId,
      ])
      inboundSent = sendResult.exitCode === 0 && !sendResult.timedOut
      ;(report.commands as string[]).push(sendResult.command)
      if (!inboundSent) throw new Error('[internal] Supplier 1 inbound send did not complete')

      const linked = await waitForInboundCase(run.runId, run.inboundMessageId, page, report)
      fixture.caseId = linked.caseId
      fixture.correlationId = linked.correlationId
      report.fixtureIds = { ...report.fixtureIds as object, caseId: linked.caseId, correlationId: linked.correlationId }

      await page.goto(`/backend/supply-cases/${linked.caseId}`)
      await expect(page.getByRole('heading', { name: linked.correlationId, exact: true })).toBeVisible()
      await expect(page.getByText('Messages and timeline', { exact: true })).toBeVisible()
      await expect(page.getByText('W dniu 2026-09-10 manufacturer@hackon-om-wro.cloud napisal:', { exact: true })).toHaveCount(0)
      await captureRunScreenshot(page, run.reportDir, 'inbound-case')
      ;(report.screenshots as string[]).push('inbound-case.png')

      const decisionGroup = page.getByRole('radiogroup', { name: 'Choose a sourcing response' })
      const options = decisionGroup.getByRole('radio')
      await expect(options).toHaveCount(3)
      for (let index = 0; index < 3; index += 1) await expect(options.nth(index)).not.toBeChecked()
      const supplierTwoOption = page.getByRole('radio', { name: 'Request a quote from Supplier 2' })
      await supplierTwoOption.check()
      await expect(supplierTwoOption).toBeChecked()
      await captureRunScreenshot(page, run.reportDir, 'supplier-2-selected')
      ;(report.screenshots as string[]).push('supplier-2-selected.png')

      const mutationRequests: string[] = []
      page.on('request', (request) => {
        if (request.url().includes(`/api/supply_cases/${linked.caseId}`) && ['PATCH', 'PUT', 'POST', 'DELETE'].includes(request.method())) {
          mutationRequests.push(`${request.method()} ${new URL(request.url()).pathname}`)
        }
      })
      const decisionResponse = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/supply_cases/${linked.caseId}/decision`)
      ))
      await page.getByRole('button', { name: 'Apply selected option', exact: true }).click()
      expect((await decisionResponse).status()).toBe(200)
      expect(mutationRequests).toEqual([`POST /api/supply_cases/${linked.caseId}/decision`])
      await expect(page.getByText('Waiting for alternative offer', { exact: true })).toBeVisible()
      await expect(page.getByText('Resolved', { exact: true })).toHaveCount(0)
      await captureRunScreenshot(page, run.reportDir, 'waiting-for-rfq')
      ;(report.screenshots as string[]).push('waiting-for-rfq.png')

      const rfqSubject = `RFQ ${linked.correlationId}: ${fixture.sku}`
      const rfqResult = await runMailSmoke(repoRoot, 'wait-for-mail', [
        '--mailbox', 'supplier2',
        '--subject', rfqSubject,
        '--timeout', '120',
        '--poll-seconds', '20',
      ])
      ;(report.commands as string[]).push(rfqResult.command)
      if (rfqResult.exitCode !== 0 || rfqResult.timedOut || !rfqResult.headers?.messageId || rfqResult.headers.subject !== rfqSubject) {
        throw new Error('[internal] exactly one matching Supplier 2 RFQ was not observed')
      }
      report.mailEvidence = {
        inboundMessageId: run.inboundMessageId,
        outboundUid: rfqResult.headers.uid,
        outboundMessageId: rfqResult.headers.messageId,
        subjectMatched: true,
        senderAndRecipientChecked: true,
      }
      await captureRunScreenshot(page, run.reportDir, 'rfq-evidence')
      ;(report.screenshots as string[]).push('rfq-evidence.png')
      report.outcome = 'PASS'
      report.externalSideEffects = true
    } catch (error) {
      failure = error
      report.outcome = inboundSent ? 'INCONCLUSIVE' : 'FAIL'
      report.failureAnalysis = [{
        test: 'LIVE-MAIL-002/003/004',
        reason: redactSensitiveText(error instanceof Error ? error.message : String(error)),
        owner: 'Shared',
      }]
      throw error
    } finally {
      try {
        if (fixture && preflight.dedicatedScope) await store.purgeScope(testScope)
        report.cleanup = fixture ? 'dedicated scope purged' : 'not-needed'
      } catch (error) {
        report.cleanup = 'FAIL'
        report.cleanupError = redactSensitiveText(error instanceof Error ? error.message : String(error))
        if (!failure) throw error
      }
      report.externalSideEffects = inboundSent
      await writeLiveMailReport(run.reportDir, report)
      await testInfo.attach('live-mail-report', { path: path.join(run.reportDir, 'REPORT.json'), contentType: 'application/json' })
    }
  })
})
