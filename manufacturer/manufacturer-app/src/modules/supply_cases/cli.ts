/**
 * `yarn mercato supply_cases send-supplier-message`
 *
 * The real call site for the outbound seam, and for now the only one: the
 * commands that will compose an RFQ and an acceptance belong to Phase 2 and
 * Phase 3 and are not written yet. It exists because a transport path that has
 * never put a message on a wire is a claim, not a capability — and because the
 * manual retry the phase plan asks for needs a handle that does not depend on
 * any UI.
 *
 * It states its scope explicitly rather than deriving one. There is no
 * authenticated actor on a CLI, and a command that guessed a tenant would be a
 * command that could mail the wrong supplier.
 */
import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { StoreScope, SupplyCasesStore } from './data/repositories'
import { outboundPhaseSchema, type OutboundPhase } from './data/types'
import { buildSupplierOutboundPorts } from './lib/outbound/ports'
import { sendSupplierMessage } from './lib/outbound/sendSupplierMessage'
import { EXPIRE_CONFIRMATIONS_COMMAND_ID, type ExpireConfirmationsResult } from './commands/resolution'

const logger = createLogger('supply_cases').child({ component: 'cli' })

type ParsedArgs = {
  scope: StoreScope
  caseId: string
  phase: OutboundPhase
  to: string
  subject: string
  body: string
  resend: boolean
}

const USAGE = [
  'Usage: yarn mercato supply_cases send-supplier-message \\',
  '  --tenant <uuid> --org <uuid> --case <caseId> --phase <ALTERNATIVE_SUPPLY_REQUEST|SUPPLY_ACCEPTANCE> \\',
  '  --to <supplier@example.com> --subject "<subject>" --body "<body>" [--resend]',
].join('\n')

const sendSupplierMessageCli: ModuleCli = {
  command: 'send-supplier-message',
  async run(argv: string[]): Promise<void> {
    let args: ParsedArgs
    try {
      args = parseArgs(argv)
    } catch (error) {
      logger.error('send-supplier-message rejected its arguments', {
        reason: error instanceof Error ? error.message : String(error),
      })
      process.stdout.write(`${USAGE}\n`)
      process.exitCode = 1
      return
    }

    const container = await createRequestContainer()
    const store = container.resolve<SupplyCasesStore>('supplyCasesStore')

    // A message is always ABOUT a case. Sending for a case that does not exist
    // in the stated scope would write an anchor nothing can ever resolve.
    const supplyCase = await store.supplyCases.findById(args.scope, args.caseId)
    if (!supplyCase) {
      logger.error('send-supplier-message found no such case in the stated scope', {
        caseId: args.caseId,
        tenantId: args.scope.tenantId,
        organizationId: args.scope.organizationId,
      })
      process.exitCode = 1
      return
    }

    const ports = buildSupplierOutboundPorts(container, store)
    const result = await sendSupplierMessage(
      ports,
      args.scope,
      {
        caseId: supplyCase.id,
        phase: args.phase,
        recipientEmail: args.to,
        subject: args.subject,
        body: args.body,
      },
      { resend: args.resend, allowedProviderKeys: undefined },
    )

    // Reported by status rather than thrown: `blocked` and `already_sent` are
    // ordinary outcomes of this command, not faults.
    switch (result.status) {
      case 'accepted':
        logger.info('supplier message sent', {
          caseId: supplyCase.id,
          phase: args.phase,
          rfcMessageId: result.rfcMessageId,
          messageId: result.messageId,
        })
        break
      case 'already_requested':
        logger.info('supplier message already anchored under this key; nothing was sent', {
          caseId: supplyCase.id,
          phase: args.phase,
          rfcMessageId: result.rfcMessageId,
        })
        break
      case 'blocked':
        logger.error('supplier message blocked', { caseId: supplyCase.id, reason: result.reason })
        process.exitCode = 1
        break
      case 'failed':
        logger.error('supplier message failed at the transport boundary', {
          caseId: supplyCase.id,
          rfcMessageId: result.rfcMessageId,
          error: result.error,
        })
        process.exitCode = 1
        break
    }
  },
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string>()
  let resend = false
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    if (token === '--resend') {
      resend = true
      continue
    }
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`[internal] ${token} needs a value`)
    }
    flags.set(token.slice(2), next)
    index += 1
  }

  const tenantId = required(flags, 'tenant')
  const organizationId = required(flags, 'org')
  const phase = outboundPhaseSchema.parse(required(flags, 'phase'))

  return {
    scope: { tenantId, organizationId },
    caseId: required(flags, 'case'),
    phase,
    to: required(flags, 'to'),
    subject: required(flags, 'subject'),
    body: required(flags, 'body'),
    resend,
  }
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)
  if (!value || value.trim().length === 0) throw new Error(`[internal] --${name} is required`)
  return value.trim()
}

/**
 * `yarn mercato supply_cases expire-confirmations`
 *
 * The scheduler sweep the spec keeps app-owned and out of scope: no cron is
 * wired up in this phase, so this is how the timeout is exercised, both in
 * demo and as the manual fallback for an operator watching a case go quiet.
 * Dispatches the same `supply_cases.resolution.expire_confirmations` command a
 * future sweeper would call, as a trusted system invocation with an explicit
 * scope — there is no authenticated actor on a CLI.
 */
type ExpireConfirmationsArgs = {
  scope: StoreScope
  caseId: string
}

const EXPIRE_USAGE = [
  'Usage: yarn mercato supply_cases expire-confirmations \\',
  '  --tenant <uuid> --org <uuid> --case <caseId>',
].join('\n')

const expireConfirmationsCli: ModuleCli = {
  command: 'expire-confirmations',
  async run(argv: string[]): Promise<void> {
    let args: ExpireConfirmationsArgs
    try {
      args = parseExpireConfirmationsArgs(argv)
    } catch (error) {
      logger.error('expire-confirmations rejected its arguments', {
        reason: error instanceof Error ? error.message : String(error),
      })
      process.stdout.write(`${EXPIRE_USAGE}\n`)
      process.exitCode = 1
      return
    }

    const container = await createRequestContainer()
    const commandBus = container.resolve<CommandBus>('commandBus')
    const commandCtx: CommandRuntimeContext = {
      container: container as unknown as AwilixContainer,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: args.scope.organizationId,
      organizationIds: [args.scope.organizationId],
      systemActor: true,
    }

    const { result } = await commandBus.execute<
      { caseId: string; scope: StoreScope },
      ExpireConfirmationsResult
    >(EXPIRE_CONFIRMATIONS_COMMAND_ID, { input: { caseId: args.caseId, scope: args.scope }, ctx: commandCtx })

    logger.info('expire-confirmations finished', { caseId: args.caseId, status: result.status })
    if (result.status === 'not_applicable') process.exitCode = 1
  },
}

function parseExpireConfirmationsArgs(argv: string[]): ExpireConfirmationsArgs {
  const flags = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`[internal] ${token} needs a value`)
    }
    flags.set(token.slice(2), next)
    index += 1
  }

  return {
    scope: { tenantId: required(flags, 'tenant'), organizationId: required(flags, 'org') },
    caseId: required(flags, 'case'),
  }
}

const cli: ModuleCli[] = [sendSupplierMessageCli, expireConfirmationsCli]

export default cli
