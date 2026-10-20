'use client'

import { useRef, useState } from 'react'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'

import { bomAvailabilityResponseSchema, parseBomAvailabilityError } from '../../lib/bomAvailabilityClient'
import type { BomRecord } from './formConfig'

type BomAvailabilityToggleProps = {
  bom: Pick<BomRecord, 'id' | 'status' | 'updatedAt' | 'isAvailableForNewOrders'>
  canManage: boolean
  disabled?: boolean
  onChanged: () => void | Promise<void>
}

export function BomAvailabilityToggle({ bom, canManage, disabled = false, onChanged }: BomAvailabilityToggleProps) {
  const t = useT()
  const [isBusy, setIsBusy] = useState(false)
  const busyRef = useRef(false)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const contextId = `manufacturing-bom-availability-${bom.id}`
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId,
    blockedMessage: t('manufacturing.boms.availability.toggle.failed'),
  })

  async function handleChange(next: boolean) {
    if (busyRef.current || !canManage || disabled) return
    if (!next) {
      const confirmed = await confirm({
        title: t('manufacturing.boms.availability.toggle.confirmTitle'),
        text: t('manufacturing.boms.availability.toggle.confirmDescription'),
        confirmText: t('manufacturing.boms.availability.toggle.confirmAction'),
        cancelText: t('ui.forms.actions.cancel'),
        variant: 'destructive',
      })
      if (!confirmed) return
    }
    const input = { id: bom.id, isAvailableForNewOrders: next }
    busyRef.current = true
    setIsBusy(true)
    try {
      await runMutation({
        mutationPayload: input,
        context: {
          formId: contextId,
          resourceKind: 'manufacturing.bom',
          resourceId: bom.id,
          record: bom,
          operation: 'custom',
          retryLastMutation,
        },
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(bom.updatedAt),
            () => apiCallOrThrow<unknown>('/api/manufacturing/boms/availability', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(input),
            }, { errorMessage: t('manufacturing.boms.availability.toggle.failed') }),
          )
          const result = bomAvailabilityResponseSchema.safeParse(call.result)
          if (!result.success || result.data.id.toLowerCase() !== bom.id.toLowerCase()) {
            throw new Error('[internal] Invalid BOM availability response')
          }
          flash(t(next ? 'manufacturing.boms.availability.toggle.enabled' : 'manufacturing.boms.availability.toggle.disabled'), 'success')
          await onChanged()
        },
      })
    } catch (error) {
      const details = parseBomAvailabilityError(error)
      if (details?.status === 409 && details.code === 'manufacturing.bom_availability.not_released') {
        flash(t('manufacturing.errors.bomAvailabilityRequiresRelease'), 'warning')
        await onChanged()
      } else if (!surfaceRecordConflict(error, t, { onRefresh: () => { void onChanged() } })) {
        flash(t('manufacturing.boms.availability.toggle.failed'), 'error')
      }
    } finally {
      busyRef.current = false
      setIsBusy(false)
    }
  }

  return (
    <>
      <SwitchField
        label={t('manufacturing.boms.availability.toggle.label')}
        description={t(bom.isAvailableForNewOrders
          ? 'manufacturing.boms.availability.toggle.descriptionOn'
          : 'manufacturing.boms.availability.toggle.descriptionOff')}
        checked={bom.isAvailableForNewOrders}
        disabled={!canManage || disabled || isBusy}
        onCheckedChange={(next) => { void handleChange(next) }}
        containerClassName="rounded-md border border-border bg-card p-4"
      />
      {ConfirmDialogElement}
    </>
  )
}
