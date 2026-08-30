"use client"

import { BomEditorClient } from "../../../../components/BomEditorClient"

export default function ManufacturingBomEditorPage({ params }: { params?: { id?: string } }) {
  const bomId = params?.id ?? ""
  return <BomEditorClient bomId={bomId} />
}
