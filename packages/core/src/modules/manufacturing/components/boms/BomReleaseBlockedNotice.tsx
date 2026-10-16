'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@open-mercato/ui/primitives/alert'

import type {
  BomReleaseTrackingViolation,
} from '../../lib/bomReleaseClient'

type BomReleaseBlockedNoticeProps = {
  violations: readonly BomReleaseTrackingViolation[] | null
}

function getVariantLabel(
  violation: BomReleaseTrackingViolation,
): string {
  const name = violation.name?.trim() || null
  const sku = violation.sku?.trim() || null

  if (name && sku) {
    return `${name} (${sku})`
  }

  return name ?? sku ?? violation.variantId
}

export function BomReleaseBlockedNotice({
  violations,
}: BomReleaseBlockedNoticeProps) {
  const t = useT()

  if (!violations?.length) {
    return null
  }

  return (
    <Alert status="error" style="light" size="default">
      <AlertTitle>
        {t('manufacturing.boms.release.blockedTitle')}
      </AlertTitle>

      <AlertDescription>
        <ul className="list-disc space-y-1 pl-5">
          {violations.map((violation) => {
            const variantLabel = getVariantLabel(violation)

            const roleLabel = t(
              `manufacturing.boms.release.role.${violation.role}`,
            )

            const requirementsLabel = violation.requirements
              .map((requirement) => (
                t(
                  `manufacturing.boms.release.requirement.${requirement}`,
                )
              ))
              .join(', ')

            return (
              <li
                key={`${violation.variantId}:${violation.role}`}
              >
                <span className="font-medium">
                  {variantLabel}
                </span>
                {' ('}
                {roleLabel}
                {'): '}
                {requirementsLabel}
              </li>
            )
          })}
        </ul>
      </AlertDescription>
    </Alert>
  )
}