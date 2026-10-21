'use client'

import { useCallback } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { postJson, readOperationOutcome, type OperationOutcome } from './executionUi'

export type ExecutionMutationTarget = {
  resourceKind: string
  resourceId: string
}

export function useExecutionMutation(contextId: string) {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId })

  return useCallback(
    (path: string, body: Record<string, unknown>, target: ExecutionMutationTarget): Promise<OperationOutcome> =>
      runMutation({
        operation: async () => {
          const call = await postJson(path, body)
          return readOperationOutcome(call.status, call.result, t('manufacturing.executions.actions.errors.failed'))
        },
        mutationPayload: body,
        context: {
          formId: contextId,
          resourceKind: target.resourceKind,
          resourceId: target.resourceId,
          operation: 'create',
          retryLastMutation,
        },
      }),
    [contextId, retryLastMutation, runMutation, t],
  )
}
