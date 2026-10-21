'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import type { ExecutionOperationListItem } from '../../data/validators'
import { OPERATION_RESUMPTIONS_API_PATH } from './executionUi'
import { useExecutionMutation } from './useExecutionMutation'

type UnresolvedOperationsAlertProps = {
  operations: ExecutionOperationListItem[]
  canRetry: boolean
  onChanged: () => void
}

export function UnresolvedOperationsAlert({ operations, canRetry, onChanged }: UnresolvedOperationsAlertProps) {
  const t = useT()
  const runExecutionMutation = useExecutionMutation('manufacturing.executions.resumeOperation')

  if (operations.length === 0) return null

  async function retry(operation: ExecutionOperationListItem) {
    const outcome = await runExecutionMutation(
      OPERATION_RESUMPTIONS_API_PATH,
      { operationId: operation.operationId },
      { resourceKind: 'manufacturing.production_execution', resourceId: operation.executionId },
    )

    if (outcome.kind === 'accepted') flash(t('manufacturing.executions.unresolved.resolved'), 'success')
    else flash(outcome.message, outcome.kind === 'unknown' ? 'warning' : 'error')

    onChanged()
  }

  return (
    <Alert status="warning" data-testid="manufacturing-unresolved-operations">
      <AlertTitle>{t('manufacturing.executions.unresolved.title')}</AlertTitle>
      <AlertDescription>
        <p>{t('manufacturing.executions.unresolved.description')}</p>
        <ul className="mt-2 space-y-2">
          {operations.map((operation) => (
            <li key={operation.operationId} className="flex flex-wrap items-center gap-2">
              <span>
                {t(`manufacturing.executions.operationAction.${operation.action}`)} ·{' '}
                {new Date(operation.createdAt).toLocaleString()}
              </span>
              {canRetry ? (
                <Button type="button" variant="outline" onClick={() => void retry(operation)}>
                  {t('manufacturing.executions.actions.retry')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
