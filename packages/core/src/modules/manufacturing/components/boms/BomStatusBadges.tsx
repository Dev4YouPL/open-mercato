'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  StatusBadge,
} from '@open-mercato/ui/primitives/status-badge'
import type {
  StatusMap,
} from '@open-mercato/ui/primitives/status-badge'

import type { BomRecord } from './formConfig'

type BomStatusBadgesProps = {
  bom: Pick<BomRecord, 'status' | 'isIncomplete'>
}

const bomStatusMap: StatusMap<BomRecord['status']> = {
  draft: 'neutral',
  released: 'success',
}

export function BomStatusBadges({
  bom,
}: BomStatusBadgesProps) {
  const t = useT()

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge variant={bomStatusMap[bom.status]} dot>
        {t(`manufacturing.boms.status.${bom.status}`)}
      </StatusBadge>

      {bom.isIncomplete ? (
        <StatusBadge variant="warning" dot>
          {t('manufacturing.boms.incomplete.badge')}
        </StatusBadge>
      ) : null}
    </div>
  )
}