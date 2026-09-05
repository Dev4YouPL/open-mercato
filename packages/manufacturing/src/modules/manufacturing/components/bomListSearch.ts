import type { CatalogLabel } from "./catalogLabels"
import { formatCatalogTarget } from "./catalogLabels"

export type BomSearchableRow = {
  productId: string
  variantId: string | null
  targetLabel: CatalogLabel
  revisionNumber: number
  revisionLabel: string | null
}

export type BomPaginationState = {
  total: number
  totalPages: number
  totalIsCapped: boolean
}

export function matchesBomSearch(row: BomSearchableRow, search: string): boolean {
  const query = search.trim().toLocaleLowerCase()
  if (!query) return true
  return [
    formatCatalogTarget(row.targetLabel, row),
    row.revisionLabel,
    `#${row.revisionNumber}`,
    row.productId,
    row.variantId,
  ].some((value) => value?.toLocaleLowerCase().includes(query))
}

export function inferBomPagination(
  cursorIndex: number,
  rowCount: number,
  pageSize: number,
  hasMore: boolean,
): BomPaginationState {
  return {
    total: cursorIndex * pageSize + rowCount + (hasMore ? 1 : 0),
    totalPages: cursorIndex + 1 + (hasMore ? 1 : 0),
    totalIsCapped: hasMore,
  }
}
