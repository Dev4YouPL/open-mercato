'use client'

import * as React from 'react'
import SupplyCaseConsole from '../../../../components/SupplyCaseConsole'

export default function SupplierCaseDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  if (!id) return null
  return <SupplyCaseConsole caseId={id} />
}
