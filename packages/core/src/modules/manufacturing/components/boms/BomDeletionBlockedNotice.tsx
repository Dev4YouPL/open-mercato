'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import type { BomDeletionFailure } from '../../lib/bomDeletionClient'

export function BomDeletionBlockedNotice({ failure, revision }: { failure: Extract<BomDeletionFailure, { kind: 'blocked' }>; revision: string }) {
  const t = useT()
  return (
    <Alert status="warning" style="light" size="default">
      <AlertTitle>{t(failure.reason === 'revision_used' ? 'manufacturing.boms.delete.blocked.revisionUsedTitle' : 'manufacturing.boms.delete.blocked.bomUsedTitle', { revision })}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-5">
          {failure.usages.map((usage, index) => (
            <li key={`${usage.bomId}-${index}`}>
              {usage.sourceNumber ? t('manufacturing.boms.delete.blocked.productionOrder', { number: usage.sourceNumber }) : t('manufacturing.boms.delete.blocked.hiddenDocument')}
            </li>
          ))}
        </ul>
        {failure.totalUsages > failure.usages.length ? <p>{t('manufacturing.boms.delete.blocked.more', { count: failure.totalUsages - failure.usages.length })}</p> : null}
      </AlertDescription>
    </Alert>
  )
}
