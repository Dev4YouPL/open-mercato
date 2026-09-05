import { inferBomPagination, matchesBomSearch, type BomSearchableRow } from "../bomListSearch"

const row: BomSearchableRow = {
  productId: "product-123",
  variantId: "variant-456",
  targetLabel: {
    productName: "Signature Haircut & Finish",
    variantName: "Standard",
    catalogState: "resolved",
  },
  revisionNumber: 4,
  revisionLabel: "Seasonal formula",
}

describe("matchesBomSearch", () => {
  it.each(["signature", "STANDARD", "seasonal", "#4", "product-123", "variant-456"])(
    "matches BOM list text for %s",
    (query) => expect(matchesBomSearch(row, query)).toBe(true),
  )

  it("matches every row for a blank query", () => {
    expect(matchesBomSearch(row, "   ")).toBe(true)
  })

  it("rejects unrelated text", () => {
    expect(matchesBomSearch(row, "packaging")).toBe(false)
  })
})

describe("inferBomPagination", () => {
  it("keeps the next keyset page reachable when more rows exist", () => {
    expect(inferBomPagination(0, 25, 25, true)).toEqual({
      total: 26,
      totalPages: 2,
      totalIsCapped: true,
    })
  })

  it("reports the last partially filled page without a phantom next page", () => {
    expect(inferBomPagination(2, 7, 25, false)).toEqual({
      total: 57,
      totalPages: 3,
      totalIsCapped: false,
    })
  })
})
