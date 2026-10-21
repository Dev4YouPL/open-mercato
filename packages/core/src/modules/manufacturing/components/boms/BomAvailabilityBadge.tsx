'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'

import type { BomAvailability } from '../../lib/bomAvailability'

type BomAvailabilityBadgeProps = {
  availability: BomAvailability
}

export function BomAvailabilityBadge({
  availability,
}: BomAvailabilityBadgeProps) {
  const t = useT()

  if (availability.isAvailable) {
    return (
      <StatusBadge variant="success" dot>
        {t('manufacturing.boms.availability.available')}
      </StatusBadge>
    )
  }

  const badge = (
    <StatusBadge
      variant={availability.reason === 'draft' ? 'neutral' : 'warning'}
      dot
    >
      {t('manufacturing.boms.availability.unavailable')}
    </StatusBadge>
  )

  if (!availability.reason) {
    return badge
  }

  // StatusBadge does not forward refs or trigger props, so the span is the tooltip anchor.
  return (
    <SimpleTooltip
      content={t(
        `manufacturing.boms.availability.reason.${availability.reason}`,
      )}
    >
      <span className="inline-flex">{badge}</span>
    </SimpleTooltip>
  )
}
