'use client'

import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useOptionalLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import type { RecordExecutionOperationInput } from '../../data/validators'
import { searchVariantOptions } from '../shared/useReferenceLabels'
import { useExecutionMutation } from './useExecutionMutation'
import {
  buildActionPayload,
  EXECUTION_OPERATIONS_API_PATH,
  newOperationId,
  OPERATION_RESUMPTIONS_API_PATH,
  postJson,
  readOperationOutcome,
  type ExecutionActionKind,
  type ExecutionActionValues,
  type OperationOutcome,
} from './executionUi'

type ExecutionActionDialogProps = {
  executionId: string
  kind: ExecutionActionKind
  open: boolean
  onClose: () => void
  onPosted: () => void
}

type PendingProblem = Extract<OperationOutcome, { kind: 'unknown' | 'blocked' }>

const FIELD_ERROR_KEYS = {
  required: 'manufacturing.executions.actions.errors.required',
  invalidQuantity: 'manufacturing.executions.actions.errors.invalidQuantity',
} as const

export function ExecutionActionDialog({ executionId, kind, open, onClose, onPosted }: ExecutionActionDialogProps) {
  const t = useT()
  const locale = useOptionalLocale()
  const contentRef = useRef<HTMLDivElement>(null)
  const operationIdRef = useRef(newOperationId())
  const lastPayloadRef = useRef<RecordExecutionOperationInput | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [problem, setProblem] = useState<PendingProblem | null>(null)
  const runExecutionMutation = useExecutionMutation('manufacturing.executions.retryOperation')
  const target = useMemo(() => ({ resourceKind: 'manufacturing.production_execution', resourceId: executionId }), [executionId])

  const fields = useMemo<CrudField[]>(() => {
    if (kind === 'confirmProduction') {
      return [
        { id: 'goodQuantity', label: t('manufacturing.executions.actions.fields.goodQuantity'), type: 'text', required: true },
        { id: 'scrapQuantity', label: t('manufacturing.executions.actions.fields.scrapQuantity'), type: 'text', required: true },
      ]
    }

    return [
      {
        id: 'variantId',
        label: t('manufacturing.executions.actions.fields.material'),
        type: 'combobox',
        required: true,
        loadOptions: searchVariantOptions,
      },
      { id: 'quantity', label: t('manufacturing.executions.actions.fields.quantity'), type: 'text', required: true },
    ]
  }, [kind, t])

  const initialValues = useMemo<ExecutionActionValues>(
    () => (kind === 'confirmProduction' ? { goodQuantity: '', scrapQuantity: '0' } : { variantId: null, quantity: '' }),
    [kind],
  )

  const finish = useCallback(() => {
    operationIdRef.current = newOperationId()
    lastPayloadRef.current = null
    setProblem(null)
    flash(t(`manufacturing.executions.actions.${kind}.posted`), 'success')
    onPosted()
    onClose()
  }, [kind, onClose, onPosted, t])

  const handleOutcome = useCallback(
    (outcome: OperationOutcome) => {
      switch (outcome.kind) {
        case 'accepted':
          finish()
          return
        case 'unknown':
        case 'blocked':
          setProblem(outcome)
          return
        case 'rejected':
          operationIdRef.current = newOperationId()
          lastPayloadRef.current = null
          throw createCrudFormError(outcome.message)
        case 'failed':
          throw createCrudFormError(outcome.message)
      }
    },
    [finish],
  )

  const send = useCallback(
    async (path: string, body: unknown): Promise<OperationOutcome> => {
      setIsSaving(true)

      try {
        const call = await postJson(path, body)
        return readOperationOutcome(call.status, call.result, t('manufacturing.executions.actions.errors.failed'))
      } finally {
        setIsSaving(false)
      }
    },
    [t],
  )

  async function guarded(path: string, body: Record<string, unknown>): Promise<OperationOutcome> {
    setIsSaving(true)

    try {
      return await runExecutionMutation(path, body, target)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSubmit(values: ExecutionActionValues) {
    const built = buildActionPayload(kind, executionId, operationIdRef.current, values, locale)

    if (built.status === 'invalid') {
      const fieldErrors = Object.fromEntries(
        Object.entries(built.fieldErrors).map(([field, reason]) => [field, t(FIELD_ERROR_KEYS[reason])]),
      )
      throw createCrudFormError(t('manufacturing.executions.actions.errors.validationFailed'), fieldErrors)
    }

    lastPayloadRef.current = built.payload
    setProblem(null)
    handleOutcome(await send(EXECUTION_OPERATIONS_API_PATH, built.payload))
  }

  async function retrySameOperation() {
    if (!lastPayloadRef.current) return
    const outcome = await guarded(EXECUTION_OPERATIONS_API_PATH, lastPayloadRef.current)

    if (outcome.kind === 'rejected' || outcome.kind === 'failed') {
      setProblem(null)
      flash(outcome.message, 'error')
      if (outcome.kind === 'rejected') operationIdRef.current = newOperationId()
      return
    }

    handleOutcome(outcome)
  }

  async function retryBlockingOperation(blockingOperationId: string) {
    const outcome = await guarded(OPERATION_RESUMPTIONS_API_PATH, { operationId: blockingOperationId })

    if (outcome.kind === 'unknown') {
      flash(outcome.message, 'warning')
      return
    }

    setProblem(null)
    onPosted()
    flash(t('manufacturing.executions.actions.blockingResolved'), outcome.kind === 'accepted' ? 'success' : 'warning')
  }

  const closeDialog = useCallback(() => {
    if (!isSaving) onClose()
  }, [isSaving, onClose])

  const handleDialogKey = useDialogKeyHandler({
    onConfirm: () => contentRef.current?.querySelector('form')?.requestSubmit(),
    onCancel: closeDialog,
    disabled: isSaving,
  })

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
      event.stopPropagation()
      handleDialogKey(event)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? undefined : closeDialog())}>
      <DialogContent
        ref={contentRef}
        size="lg"
        dismissible={!isSaving}
        aria-describedby={undefined}
        onKeyDownCapture={handleKeyDownCapture}
      >
        <DialogHeader>
          <DialogTitle>{t(`manufacturing.executions.actions.${kind}.title`)}</DialogTitle>
        </DialogHeader>

        {problem ? (
          <Alert
            status="warning"
            action={
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() =>
                  void (problem.kind === 'unknown' ? retrySameOperation() : retryBlockingOperation(problem.blockingOperationId))
                }
              >
                {t(problem.kind === 'unknown' ? 'manufacturing.executions.actions.retry' : 'manufacturing.executions.actions.retryBlocking')}
              </Button>
            }
          >
            <AlertDescription>{problem.message}</AlertDescription>
          </Alert>
        ) : null}

        <fieldset disabled={isSaving || problem?.kind === 'unknown'} className="min-w-0">
          <CrudForm<ExecutionActionValues>
            formId={`manufacturing-execution-${kind}`}
            embedded
            fields={fields}
            initialValues={initialValues}
            submitLabel={t(`manufacturing.executions.actions.${kind}.submit`)}
            onSubmit={handleSubmit}
            extraActions={
              <Button type="button" variant="outline" disabled={isSaving} onClick={closeDialog}>
                {t('ui.forms.actions.cancel')}
              </Button>
            }
          />
        </fieldset>
      </DialogContent>
    </Dialog>
  )
}
