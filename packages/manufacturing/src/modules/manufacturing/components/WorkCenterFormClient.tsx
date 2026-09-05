"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  CrudForm,
  type CrudField,
  type CrudFormGroup,
  type CrudCustomFieldRenderProps,
} from "@open-mercato/ui/backend/CrudForm"
import { createCrud, updateCrud } from "@open-mercato/ui/backend/utils/crud"
import { flash } from "@open-mercato/ui/backend/FlashMessages"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { WorkCenterResourcePicker } from "./WorkCenterResourcePicker"
import { sortResourceIds } from "./workCenterResourceOptions"
import { toWorkCenterFormError } from "./workCenterFormErrors"
import { useWorkCenterPermissions } from "./useWorkCenterPermissions"
import { extensionPoints } from "../extension-points"

const LIST_HREF = "/backend/manufacturing/work-centers"

export type WorkCenterFormInitial = {
  id: string
  updatedAt: string
  code: string
  name: string
  description: string | null
  isActive: boolean
  resourceIds: string[]
}

type WorkCenterFormValues = {
  code: string
  name: string
  description: string | null
  isActive: boolean
  resourceIds: string[]
  /** Carried so CrudForm derives the optimistic-lock header for save and delete. */
  updatedAt?: string
}

export function WorkCenterFormClient({ initial }: { initial?: WorkCenterFormInitial }) {
  const t = useT()
  const router = useRouter()
  const isEdit = Boolean(initial?.id)
  const { canManage, canViewResources, isLoading: permissionsLoading } = useWorkCenterPermissions()

  // Without `resources.view` the picker must not issue a lookup at all, and no
  // membership change may be offered — the server would reject it anyway.
  const membershipUnavailable = permissionsLoading || canViewResources ? null : "forbidden"
  const scopeKey = initial?.id ?? "create"
  const storedResourceIds = React.useMemo(() => sortResourceIds(initial?.resourceIds ?? []), [initial?.resourceIds])

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: "code",
        label: t("manufacturing.workCenters.form.code", "Code"),
        type: "text",
        required: true,
        layout: "half",
        description: t("manufacturing.workCenters.form.codeHint", "Unique within this organization."),
      },
      {
        id: "name",
        label: t("manufacturing.workCenters.form.name", "Name"),
        type: "text",
        required: true,
        layout: "half",
      },
      {
        id: "description",
        label: t("manufacturing.workCenters.form.description", "Description"),
        type: "textarea",
        layout: "full",
      },
      {
        id: "isActive",
        label: t("manufacturing.workCenters.form.isActive", "Active"),
        type: "checkbox",
        layout: "full",
      },
      {
        id: "resourceIds",
        label: t("manufacturing.workCenters.picker.label", "Resources"),
        type: "custom",
        layout: "full",
        component: ({ value, setValue }: CrudCustomFieldRenderProps) => (
          <WorkCenterResourcePicker
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={setValue}
            scopeKey={scopeKey}
            disabled={!canManage}
            unavailableReason={membershipUnavailable}
          />
        ),
      },
    ],
    [canManage, membershipUnavailable, scopeKey, t],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: "basic",
        title: t("manufacturing.workCenters.form.group.basic", "Basic data"),
        column: 1,
        fields: ["code", "name", "description", "isActive"],
      },
      {
        id: "resources",
        title: t("manufacturing.workCenters.form.group.resources", "Resources"),
        column: 2,
        description: t(
          "manufacturing.workCenters.form.group.resourcesDescription",
          "Resources that belong to this work centre. Membership describes a manufacturing context, not a reservation.",
        ),
        fields: ["resourceIds"],
      },
    ],
    [t],
  )

  const initialValues = React.useMemo<Partial<WorkCenterFormValues>>(
    () => ({
      code: initial?.code ?? "",
      name: initial?.name ?? "",
      description: initial?.description ?? null,
      isActive: initial?.isActive ?? true,
      resourceIds: storedResourceIds,
      ...(initial?.updatedAt ? { updatedAt: initial.updatedAt } : {}),
    }),
    [initial, storedResourceIds],
  )

  return (
    <CrudForm<WorkCenterFormValues>
      injectionSpotId={extensionPoints.hosts.workCenterForm.spotId}
      replacementHandle={extensionPoints.hosts.workCenterForm.spotId}
      title={
        isEdit
          ? t("manufacturing.workCenters.detail.title", "Work centre")
          : t("manufacturing.workCenters.create.title", "New work centre")
      }
      backHref={LIST_HREF}
      cancelHref={LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      optimisticLockUpdatedAt={initial?.updatedAt ?? null}
      readOnly={!canManage}
      submitLabel={
        isEdit
          ? t("manufacturing.workCenters.form.save", "Save")
          : t("manufacturing.workCenters.form.create", "Create work centre")
      }
      onSubmit={async (values) => {
        const nextResourceIds = sortResourceIds(values.resourceIds ?? [])
        const membershipChanged =
          nextResourceIds.length !== storedResourceIds.length ||
          nextResourceIds.some((id, index) => id !== storedResourceIds[index])
        try {
          if (isEdit && initial) {
            await updateCrud("manufacturing/work-centers", {
              id: initial.id,
              code: values.code,
              name: values.name,
              description: values.description || null,
              isActive: Boolean(values.isActive),
              // Omitted when unchanged, so a scalar-only edit never needs the
              // optional resources provider.
              ...(membershipChanged ? { resourceIds: nextResourceIds } : {}),
            })
            flash(t("manufacturing.workCenters.detail.success", "Work centre saved"), "success")
            router.refresh()
            return
          }
          const { result } = await createCrud<{ id: string }>("manufacturing/work-centers", {
            code: values.code,
            name: values.name,
            description: values.description || null,
            isActive: Boolean(values.isActive),
            // An empty set is an unassigned work centre and resolves no provider.
            ...(nextResourceIds.length > 0 ? { resourceIds: nextResourceIds } : {}),
          })
          flash(t("manufacturing.workCenters.create.success", "Work centre created"), "success")
          router.push(result?.id ? `${LIST_HREF}/${result.id}` : LIST_HREF)
        } catch (err) {
          throw toWorkCenterFormError(err, t)
        }
      }}
    />
  )
}

export default WorkCenterFormClient
