'use client'

import {
    useEffect,
    useRef,
    useState,
} from 'react'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
    getTelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'
import {
    useConfirmDialog,
} from '@open-mercato/ui/backend/confirm-dialog'
import {
    surfaceRecordConflict,
} from '@open-mercato/ui/backend/conflicts'
import {
    flash,
} from '@open-mercato/ui/backend/FlashMessages'
import {
    useGuardedMutation,
} from '@open-mercato/ui/backend/injection/useGuardedMutation'
import {
    apiCallOrThrow,
    withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import {
    buildOptimisticLockHeader,
} from '@open-mercato/ui/backend/utils/optimisticLock'
import { Button } from '@open-mercato/ui/primitives/button'

import {
    bomReleaseResponseSchema,
    loadAllBomReleaseItems,
    parseBomReleaseError,
} from '../../lib/bomReleaseClient'
import type {
    BomReleaseTrackingViolation,
} from '../../lib/bomReleaseClient'
import type { BomRecord } from './formConfig'
import { Alert } from '@open-mercato/ui/primitives/alert'

type BomReleaseActionProps = {
    bom: BomRecord
    onReleased: () => void | Promise<void>
    disabled?: boolean
    onBlocked?: (
        violations: BomReleaseTrackingViolation[] | null,
    ) => void
}

export function BomReleaseAction({
    bom,
    onReleased,
    disabled = false,
    onBlocked,
}: BomReleaseActionProps) {
    const t = useT()

    const [isBusy, setIsBusy] = useState(false)

    const activeRef = useRef(true)
    const busyRef = useRef(false)
    const submittingRef = useRef(false)
    const loadControllerRef = useRef<AbortController | null>(null)
    const latestBomRef = useRef(bom)
    const canReleaseRef = useRef(false)

    latestBomRef.current = bom
    canReleaseRef.current = !disabled && bom.status === 'draft'

    const contextId = `manufacturing-bom-release-${bom.id}`

    const { confirm, ConfirmDialogElement } = useConfirmDialog()

    const { runMutation, retryLastMutation } = useGuardedMutation({
        contextId,
        blockedMessage: t('manufacturing.boms.release.failed'),
    })

    useEffect(() => {
        activeRef.current = true

        return () => {
            activeRef.current = false
            loadControllerRef.current?.abort()
        }
    }, [])

    function finishBusyState() {
        if (submittingRef.current) return

        busyRef.current = false

        if (activeRef.current) {
            setIsBusy(false)
        }
    }

    async function refreshBom() {
        if (!activeRef.current) return

        try {
            await onReleased()
        } catch (error) {
            getTelemetryRuntime()?.reportError(error, {
                module: 'manufacturing',
                code: 'manufacturing.bom_release_refresh_failed',
            })

            if (activeRef.current) {
                flash(
                    t('manufacturing.boms.release.refreshFailed'),
                    'warning',
                )
            }
        }
    }

    async function handleMutationError(error: unknown) {
        getTelemetryRuntime()?.reportError(error, {
            module: 'manufacturing',
            code: 'manufacturing.bom_release_client_failed',
        })

        if (!activeRef.current) return

        const details = parseBomReleaseError(error)

        if (
            details?.status === 409 &&
            details.code === 'manufacturing.bom_release.items_changed'
        ) {
            flash(
                t('manufacturing.errors.bomReleaseItemsChanged'),
                'warning',
            )

            await refreshBom()
            return
        }

        if (
            surfaceRecordConflict(error, t, {
                onRefresh: () => {
                    void refreshBom()
                },
            })
        ) {
            return
        }

        if (
            details?.status === 422 &&
            details.code === 'manufacturing.bom_release.tracking_required' &&
            details.violations
        ) {
            if (onBlocked) {
                onBlocked(details.violations)
            } else {
                flash(
                    t('manufacturing.errors.bomReleaseTrackingRequired'),
                    'error',
                )
            }

            return
        }

        flash(t('manufacturing.boms.release.failed'), 'error')
    }

    async function handleRelease() {
        if (
            !activeRef.current ||
            !canReleaseRef.current ||
            busyRef.current
        ) {
            return
        }

        busyRef.current = true
        setIsBusy(true)

        let enteredMutation = false
        let mutationErrorHandled = false

        const controller = new AbortController()
        loadControllerRef.current = controller

        try {
            onBlocked?.(null)

            const expectedItems = await loadAllBomReleaseItems(
                bom.id,
                t('manufacturing.boms.release.loadItemsFailed'),
                controller.signal,
            )

            if (
                !activeRef.current ||
                controller.signal.aborted ||
                !canReleaseRef.current
            ) {
                return
            }

            const text = [
                t('manufacturing.boms.release.confirmDescription'),
                t('manufacturing.boms.release.confirmItemCount', {
                    count: expectedItems.length,
                }),
                expectedItems.length === 0
                    ? t('manufacturing.boms.release.confirmEmpty')
                    : null,
            ]
                .filter((part): part is string => part !== null)
                .join(' ')

            const confirmed = await confirm({
                title: t('manufacturing.boms.release.confirmTitle'),
                text,
                confirmText: t('manufacturing.boms.release.action'),
                cancelText: t('ui.forms.actions.cancel'),
                variant: 'default',
            })

            if (!confirmed || !activeRef.current) {
                return
            }

            const input = {
                id: bom.id,
                expectedItems,
            }

            enteredMutation = true

            await runMutation({
                mutationPayload: input,
                context: {
                    formId: contextId,
                    resourceKind: 'manufacturing.bom',
                    resourceId: bom.id,
                    record: bom,
                    operation: 'custom',
                    retryLastMutation,
                },
                operation: async () => {
                    if (submittingRef.current) {
                        throw new Error('[internal] BOM release already in progress')
                    }

                    submittingRef.current = true
                    busyRef.current = true

                    if (activeRef.current) {
                        setIsBusy(true)
                    }

                    try {
                        if (
                            !activeRef.current ||
                            !canReleaseRef.current ||
                            latestBomRef.current.id !== input.id
                        ) {
                            throw new Error('[internal] BOM release context is no longer active')
                        }

                        const call = await withScopedApiRequestHeaders(
                            buildOptimisticLockHeader(bom.updatedAt),
                            () => apiCallOrThrow<unknown>(
                                '/api/manufacturing/boms/release',
                                {
                                    method: 'POST',
                                    headers: {
                                        'content-type': 'application/json',
                                    },
                                    body: JSON.stringify(input),
                                },
                                {
                                    errorMessage: t(
                                        'manufacturing.boms.release.failed',
                                    ),
                                },
                            ),
                        )

                        const parsed = bomReleaseResponseSchema.safeParse(
                            call.result,
                        )

                        if (
                            !parsed.success ||
                            parsed.data.id.toLowerCase() !== input.id.toLowerCase()
                        ) {
                            await refreshBom()

                            throw new Error('[internal] Invalid BOM release response')
                        }

                        if (activeRef.current) {
                            flash(
                                t(
                                    parsed.data.isIncomplete
                                        ? 'manufacturing.boms.release.successIncomplete'
                                        : 'manufacturing.boms.release.success',
                                ),
                                parsed.data.isIncomplete ? 'warning' : 'success',
                            )

                            await refreshBom()
                        }

                        return parsed.data
                    } catch (error) {
                        mutationErrorHandled = true

                        await handleMutationError(error)
                        throw error
                    } finally {
                        submittingRef.current = false
                        finishBusyState()
                    }
                },
            })
        } catch (error) {
            if (!mutationErrorHandled) {
                if (enteredMutation) {
                    await handleMutationError(error)
                } else if (
                    activeRef.current &&
                    !controller.signal.aborted
                ) {
                    getTelemetryRuntime()?.reportError(error, {
                        module: 'manufacturing',
                        code: 'manufacturing.bom_release_items_load_failed',
                    })

                    flash(
                        t('manufacturing.boms.release.loadItemsFailed'),
                        'error',
                    )
                }
            }
        } finally {
            if (loadControllerRef.current === controller) {
                loadControllerRef.current = null
            }

            finishBusyState()
        }
    }

    if (bom.status !== 'draft') {
        return null
    }

    return (
        <>
            <Button
                type="button"
                disabled={disabled || isBusy}
                aria-busy={isBusy}
                onClick={() => {
                    void handleRelease()
                }}
            >
                {t(
                    isBusy
                        ? 'manufacturing.boms.release.working'
                        : 'manufacturing.boms.release.action',
                )}
            </Button>

            {ConfirmDialogElement}
        </>
    )
}