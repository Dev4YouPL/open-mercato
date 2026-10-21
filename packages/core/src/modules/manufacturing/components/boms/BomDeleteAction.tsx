'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Button } from '@open-mercato/ui/primitives/button'
import { bomDeletionPreviewSchema, parseBomDeletionError } from '../../lib/bomDeletionClient'
import type { BomDeletionFailure } from '../../lib/bomDeletionClient'
import { BomDeletionBlockedNotice } from './BomDeletionBlockedNotice'

export type BomDeleteActionRecord = { id: string; revision: string; updatedAt: string; outputVariantId: string; outputVariant?: { name?: string | null; sku?: string | null } | null }

export type BomDeletionBlockedFailure = Extract<BomDeletionFailure, { kind: 'blocked' }>

export function BomDeleteAction({ bom, disabled = false, onChanged, onRefresh, onBlocked }: { bom: BomDeleteActionRecord; disabled?: boolean; onChanged?: () => void | Promise<void>; onRefresh?: () => void | Promise<void>; onBlocked?: (failure: BomDeletionBlockedFailure | null) => void }) {
  const t = useT()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [blocked, setBlockedState] = useState<BomDeletionBlockedFailure | null>(null)
  const setBlocked = (failure: BomDeletionBlockedFailure | null) => {
    setBlockedState(failure)
    onBlocked?.(failure)
  }
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const contextId = `manufacturing-bom-delete-${bom.id}`
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId, blockedMessage: t('manufacturing.boms.delete.failed') })

  async function refreshAfterConflict() {
    const refresh = onRefresh ?? onChanged
    if (refresh) await refresh()
    else router.refresh()
  }

  async function start(scope: 'revision' | 'bom') {
    if (busy || disabled) return
    setBusy(true)
    setBlocked(null)
    try {
      const previewPayload = await readApiResultOrThrow<unknown>(`/api/manufacturing/boms/deletion-preview?id=${encodeURIComponent(bom.id)}`, {}, { errorMessage: t('manufacturing.boms.delete.failed') })
      const preview = bomDeletionPreviewSchema.parse(previewPayload)
      const decision = scope === 'revision' ? preview.revisionDeletion : preview.bomDeletion
      if (!decision.allowed) {
        setBlocked({ kind: 'blocked', reason: decision.reason === 'revision_used' ? 'revision_used' : 'bom_used', totalUsages: decision.totalUsages, usages: decision.usages })
        return
      }
      const records = scope === 'revision' ? [preview.revision] : preview.revisions
      const variant = preview.outputVariant?.name || preview.outputVariant?.sku || preview.outputVariant?.id || bom.outputVariantId
      const confirmed = await confirm({
        title: t(scope === 'revision' ? 'manufacturing.boms.delete.confirmRevisionTitle' : 'manufacturing.boms.delete.confirmBomTitle'),
        text: t(scope === 'revision' ? 'manufacturing.boms.delete.confirmRevisionText' : 'manufacturing.boms.delete.confirmBomText', { variant, revisions: records.map((record) => record.revision).join(', '), items: records.reduce((count, record) => count + record.itemCount, 0) }),
        confirmText: t('manufacturing.boms.delete.confirmAction'), cancelText: t('ui.forms.actions.cancel'), variant: 'destructive',
      })
      if (!confirmed) return
      const mutationPayload = scope === 'revision' ? { id: bom.id, expectedVersion: preview.revisionVersion } : { outputVariantId: bom.outputVariantId, expectedVersion: preview.bomVersion }
      await runMutation({ mutationPayload, context: { formId: contextId, resourceKind: 'manufacturing.bom', resourceId: bom.id, record: bom, operation: 'delete', retryLastMutation }, operation: async () => {
        if (scope === 'revision') {
          await withScopedApiRequestHeaders(buildOptimisticLockHeader(preview.revision.updatedAt), () => apiCallOrThrow('/api/manufacturing/boms', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mutationPayload) }, { errorMessage: t('manufacturing.boms.delete.failed') }))
        } else {
          await apiCallOrThrow('/api/manufacturing/boms/delete-all', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mutationPayload) }, { errorMessage: t('manufacturing.boms.delete.failed') })
        }
        flash(t(scope === 'revision' ? 'manufacturing.boms.delete.revisionDeleted' : 'manufacturing.boms.delete.bomDeleted'), 'success')
        if (onChanged) await onChanged()
        else router.push('/backend/manufacturing/boms')
      } })
    } catch (error) {
      getTelemetryRuntime()?.reportError(error, { module: 'manufacturing', code: 'manufacturing.bom_delete_client_failed' })
      const failure = parseBomDeletionError(error)
      if (failure.kind === 'blocked') setBlocked(failure)
      else if (failure.kind === 'stale') {
        flash(t('manufacturing.errors.bomChangedRefresh'), 'warning')
        await refreshAfterConflict()
      } else if (!surfaceRecordConflict(error, t, { onRefresh: () => { void refreshAfterConflict() } })) flash(t('manufacturing.boms.delete.failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return <div className="flex flex-wrap items-center gap-2">
    <Button type="button" variant="destructive" size="sm" disabled={disabled || busy} onClick={() => { void start('revision') }}>{t('manufacturing.boms.delete.revision')}</Button>
    <Button type="button" variant="destructive" size="sm" disabled={disabled || busy} onClick={() => { void start('bom') }}>{t('manufacturing.boms.delete.bom')}</Button>
    {blocked && !onBlocked ? <BomDeletionBlockedNotice failure={blocked} revision={bom.revision} /> : null}
    {ConfirmDialogElement}
  </div>
}
