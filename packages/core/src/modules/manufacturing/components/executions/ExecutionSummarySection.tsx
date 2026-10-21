'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import type { ExecutionSummary } from './executionUi'

type ExecutionSummarySectionProps = {
  summary: ExecutionSummary
  plannedQuantity: number | null
  variantLabels: Record<string, string>
}

export function ExecutionSummarySection({ summary, plannedQuantity, variantLabels }: ExecutionSummarySectionProps) {
  const t = useT()
  const { output, materials } = summary

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t('manufacturing.executions.summary.output.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {plannedQuantity !== null ? (
              <>
                <dt className="text-muted-foreground">{t('manufacturing.executions.summary.output.planned')}</dt>
                <dd>{output.plannedQuantity}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t('manufacturing.executions.summary.output.good')}</dt>
            <dd>{output.goodQuantity}</dd>
            <dt className="text-muted-foreground">{t('manufacturing.executions.summary.output.scrap')}</dt>
            <dd>{output.scrapQuantity}</dd>
            {plannedQuantity !== null ? (
              <>
                <dt className="text-muted-foreground">{t('manufacturing.executions.summary.output.difference')}</dt>
                <dd>{output.difference}</dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('manufacturing.executions.summary.materials.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {materials.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('manufacturing.executions.summary.materials.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('manufacturing.executions.summary.materials.variant')}</TableHead>
                  <TableHead>{t('manufacturing.executions.summary.materials.netIssued')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materials.map((material) => (
                  <TableRow key={material.variantId}>
                    <TableCell>{variantLabels[material.variantId] ?? material.variantId}</TableCell>
                    <TableCell>{material.issuedQuantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
