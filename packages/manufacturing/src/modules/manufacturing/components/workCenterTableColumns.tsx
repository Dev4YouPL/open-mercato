"use client"

import * as React from "react"
import Link from "next/link"
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy"
import { StatusBadge } from "@open-mercato/ui/primitives/status-badge"

export const WORK_CENTERS_LIST_HREF = "/backend/manufacturing/work-centers"

export type WorkCenterRow = {
  id: string
  code: string
  name: string
  isActive: boolean
  resourceCount: number
  updatedAt: string
}

type Translate = (key: string, fallback?: string) => string

/**
 * Column definitions for the Work Centre list, kept beside the island rather
 * than inside it so the client component stays within its size budget.
 */
export function buildWorkCenterColumns(t: Translate): ColumnDef<WorkCenterRow>[] {
  return [
    {
      accessorKey: "code",
      header: t("manufacturing.workCenters.columns.code", "Code"),
      meta: { alwaysVisible: true, truncate: true, maxWidth: "220px" },
      cell: ({ row }) => (
        <Link href={`${WORK_CENTERS_LIST_HREF}/${row.original.id}`} className="font-medium hover:underline">
          {row.original.code}
        </Link>
      ),
    },
    {
      accessorKey: "name",
      header: t("manufacturing.workCenters.columns.name", "Name"),
      meta: { truncate: true, maxWidth: "320px" },
    },
    {
      accessorKey: "isActive",
      header: t("manufacturing.workCenters.columns.isActive", "Status"),
      meta: { maxWidth: "160px" },
      cell: ({ row }) => (
        <StatusBadge variant={row.original.isActive ? "success" : "neutral"} dot>
          {row.original.isActive
            ? t("manufacturing.workCenters.status.active", "Active")
            : t("manufacturing.workCenters.status.inactive", "Inactive")}
        </StatusBadge>
      ),
    },
    {
      accessorKey: "resourceCount",
      header: t("manufacturing.workCenters.columns.resourceCount", "Resources"),
      // Deliberately not sortable: the count is a per-page enrichment, not a
      // queryable column, so there is no supported aggregate sort behind it.
      enableSorting: false,
      meta: { maxWidth: "140px" },
      cell: ({ row }) => row.original.resourceCount,
    },
    {
      accessorKey: "updatedAt",
      header: t("manufacturing.workCenters.columns.updatedAt", "Updated"),
      meta: { maxWidth: "220px" },
      cell: ({ row }) => new Date(row.original.updatedAt).toLocaleString(),
    },
  ]
}
