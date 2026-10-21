'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { TabEmptyState } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import type { ExecutionDocumentListItem } from '../../data/validators'
import type { ExecutionDocumentType } from '../../domain/executionDocument'
import { DOCUMENT_REVERSALS_API_PATH, newOperationId } from './executionUi'
import { useExecutionMutation } from './useExecutionMutation'

const DOCUMENT_TYPE_BADGES: StatusMap<ExecutionDocumentType> = {
  issue: 'info',
  return: 'neutral',
  confirmation: 'success',
  reversal: 'warning',
}

type ExecutionDocumentsSectionProps = {
  documents: ExecutionDocumentListItem[]
  variantLabels: Record<string, string>
  locationLabels: Record<string, string>
  canReverse: boolean
  onChanged: () => void
}

function documentNumbers(documents: ExecutionDocumentListItem[]): Map<string, number> {
  return new Map(documents.map((document, index) => [document.id, index + 1]))
}

export function ExecutionDocumentsSection({
  documents,
  variantLabels,
  locationLabels,
  canReverse,
  onChanged,
}: ExecutionDocumentsSectionProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const runExecutionMutation = useExecutionMutation('manufacturing.executions.reverseDocument')
  const numbers = documentNumbers(documents)

  async function reverse(document: ExecutionDocumentListItem) {
    const confirmed = await confirm({
      title: t('manufacturing.executions.history.reverse.confirmTitle'),
      text: t('manufacturing.executions.history.reverse.confirmText'),
      confirmText: t('manufacturing.executions.history.reverse.action'),
      variant: 'destructive',
    })

    if (!confirmed) return

    const outcome = await runExecutionMutation(
      DOCUMENT_REVERSALS_API_PATH,
      { operationId: newOperationId(), documentId: document.id },
      { resourceKind: 'manufacturing.execution_document', resourceId: document.id },
    )

    if (outcome.kind === 'accepted') flash(t('manufacturing.executions.history.reverse.posted'), 'success')
    else flash(outcome.message, outcome.kind === 'unknown' || outcome.kind === 'blocked' ? 'warning' : 'error')

    onChanged()
  }

  if (documents.length === 0) {
    return (
      <TabEmptyState
        title={t('manufacturing.executions.history.empty.title')}
        description={t('manufacturing.executions.history.empty.description')}
      />
    )
  }

  return (
    <div className="space-y-3">
      {documents.map((document) => {
        const reversesNumber = document.reversesDocumentId ? numbers.get(document.reversesDocumentId) : undefined
        const reversedByNumber = document.reversedByDocumentId ? numbers.get(document.reversedByDocumentId) : undefined

        return (
          <Card key={document.id} data-testid="manufacturing-execution-document">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>#{numbers.get(document.id)}</span>
                <StatusBadge variant={DOCUMENT_TYPE_BADGES[document.documentType]} dot>
                  {t(`manufacturing.executions.documentType.${document.documentType}`)}
                </StatusBadge>
                {document.reversedByDocumentId ? (
                  <StatusBadge variant="neutral">
                    {t('manufacturing.executions.history.reversedBy', { number: reversedByNumber ?? '?' })}
                  </StatusBadge>
                ) : null}
              </CardTitle>
              <CardDescription>
                {new Date(document.postedAt).toLocaleString()}
                {reversesNumber ? ` · ${t('manufacturing.executions.history.reverses', { number: reversesNumber })}` : ''}
              </CardDescription>
              {canReverse && !document.reversedByDocumentId ? (
                <CardAction>
                  <Button type="button" variant="outline" onClick={() => void reverse(document)}>
                    {t('manufacturing.executions.history.reverse.action')}
                  </Button>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('manufacturing.executions.history.columns.fact')}</TableHead>
                    <TableHead>{t('manufacturing.executions.history.columns.variant')}</TableHead>
                    <TableHead>{t('manufacturing.executions.history.columns.quantity')}</TableHead>
                    <TableHead>{t('manufacturing.executions.history.columns.location')}</TableHead>
                    <TableHead>{t('manufacturing.executions.history.columns.movement')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {document.facts.map((fact) => (
                    <TableRow key={fact.id}>
                      <TableCell>{t(`manufacturing.executions.factKind.${fact.factKind}`)}</TableCell>
                      <TableCell>{variantLabels[fact.variantId] ?? fact.variantId}</TableCell>
                      <TableCell>{fact.quantity}</TableCell>
                      <TableCell>{fact.locationId ? locationLabels[fact.locationId] ?? fact.locationId : '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{fact.movementId ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      })}
      {ConfirmDialogElement}
    </div>
  )
}
