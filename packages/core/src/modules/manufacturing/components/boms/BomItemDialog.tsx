'use client'

import {
    useCallback,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
} from 'react'

import {
    useOptionalLocale,
    useT,
} from '@open-mercato/shared/lib/i18n/context'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
    createCrud,
    updateCrud,
} from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { Button } from '@open-mercato/ui/primitives/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@open-mercato/ui/primitives/dialog'

import {
    BOM_ITEM_FORM_SPOT_ID,
    buildBomItemCreatePayload,
    buildBomItemFields,
    buildBomItemGroups,
    buildBomItemUpdatePayload,
    type BomFormValues,
    type BomItemRecord,
} from './formConfig'

export type BomItemDialogProps = {
    bomId: string
    item?: BomItemRecord | null
    defaultPosition?: number
    open: boolean
    onClose: () => void
    onSaved: () => Promise<void> | void
}

export function BomItemDialog({
    bomId,
    item = null,
    defaultPosition = 1,
    open,
    onClose,
    onSaved,
}: BomItemDialogProps) {
    const t = useT()
    const locale = useOptionalLocale()
    const contentRef = useRef<HTMLDivElement>(null)
    const savingRef = useRef(false)
    const [isSaving, setIsSaving] = useState(false)

    const invalidParent = item !== null && item.bomId !== bomId

    const fields = useMemo(
        () => buildBomItemFields(t, isSaving),
        [t, isSaving],
    )

    const groups = useMemo(() => buildBomItemGroups(), [])

    const initialValues = useMemo<BomFormValues>(() => {
        if (item) {
            return {
                id: item.id,
                bomId,
                componentVariantId: item.componentVariantId,
                quantity: item.quantity,
                position: item.position,
                updatedAt: item.updatedAt,
            }
        }

        return {
            bomId,
            componentVariantId: null,
            quantity: '1',
            position: defaultPosition,
        }
    }, [bomId, item, defaultPosition])

    const closeDialog = useCallback(() => {
        if (!savingRef.current) {
            onClose()
        }
    }, [onClose])

    const submitDialog = useCallback(() => {
        if (!savingRef.current && !invalidParent) {
            contentRef.current?.querySelector('form')?.requestSubmit()
        }
    }, [invalidParent])

    const handleDialogKey = useDialogKeyHandler({
        onConfirm: submitDialog,
        onCancel: closeDialog,
        disabled: isSaving || invalidParent,
    })

    const handleKeyDownCapture = useCallback(
        (event: KeyboardEvent<HTMLDivElement>) => {
            const isSubmitShortcut = event.key === 'Enter'
                && (event.ctrlKey || event.metaKey)

            if (event.key === 'Escape' || isSubmitShortcut) {
                event.stopPropagation()
                handleDialogKey(event)
            }
        },
        [handleDialogKey],
    )

    async function handleSubmit(values: BomFormValues) {
        if (invalidParent) {
            throw createCrudFormError(
                t('manufacturing.errors.bomItemUnavailable'),
            )
        }

        if (savingRef.current) {
            return
        }

        savingRef.current = true
        setIsSaving(true)

        try {
            if (item) {
                const payload = buildBomItemUpdatePayload(
                    bomId,
                    item.id,
                    values,
                    t,
                    locale,
                )

                await updateCrud(
                    'manufacturing/bom-items',
                    payload,
                    {
                        errorMessage: t('manufacturing.forms.saveFailed'),
                    },
                )
            } else {
                const payload = buildBomItemCreatePayload(
                    bomId,
                    values,
                    t,
                    locale,
                )

                await createCrud(
                    'manufacturing/bom-items',
                    payload,
                    {
                        errorMessage: t('manufacturing.forms.saveFailed'),
                    },
                )
            }

            flash(t('manufacturing.forms.saved'), 'success')

            try {
                await onSaved()
            } catch {
                flash(t('manufacturing.forms.refreshFailed'), 'warning')
            }

            onClose()
        } finally {
            savingRef.current = false
            setIsSaving(false)
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    closeDialog()
                }
            }}>
            <DialogContent
                ref={contentRef}
                size="lg"
                dismissible={!isSaving}
                aria-describedby={undefined}
                onKeyDownCapture={handleKeyDownCapture}
                onEscapeKeyDown={(event) => {
                    if (savingRef.current) {
                        event.preventDefault()
                    }
                }}
                onPointerDownOutside={(event) => {
                    if (savingRef.current) {
                        event.preventDefault()
                    }
                }}>
                <DialogHeader>
                    <DialogTitle>
                        {t(
                            item
                                ? 'manufacturing.bomItems.form.editTitle'
                                : 'manufacturing.bomItems.form.createTitle',
                        )}
                    </DialogTitle>
                </DialogHeader>

                {invalidParent ? (
                    <div className="space-y-4">
                        <p role="alert" className="text-sm text-muted-foreground">
                            {t('manufacturing.errors.bomItemUnavailable')}
                        </p>

                        <Button
                            type="button"
                            variant="outline"
                            onClick={closeDialog}>
                            {t('ui.forms.actions.cancel')}
                        </Button>
                    </div>
                ) : (
                    <fieldset disabled={isSaving} className="min-w-0">
                        <CrudForm<BomFormValues>
                            key={`${bomId}:${item?.id ?? 'create'}`}
                            formId={`manufacturing-bom-item-${item?.id ?? 'create'}`}
                            injectionSpotId={BOM_ITEM_FORM_SPOT_ID}
                            embedded
                            fields={fields}
                            groups={groups}
                            initialValues={initialValues}
                            submitLabel={t('ui.forms.actions.save')}
                            onSubmit={handleSubmit}
                            extraActions={
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={isSaving}
                                    onClick={closeDialog}
                                >
                                    {t('ui.forms.actions.cancel')}
                                </Button>
                            }
                        />
                    </fieldset>
                )}
            </DialogContent>
        </Dialog>
    )
}