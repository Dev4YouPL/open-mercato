export type SupplyStoreErrorCode =
  | 'not_found'
  | 'duplicate_rfc_message_id'
  | 'duplicate_record_key'
  | 'scope_mismatch'
  | 'append_only_violation'
  | 'store_file_corrupted'
  | 'version_conflict'
  | 'offer_conflict'

export class SupplyStoreError extends Error {
  readonly code: SupplyStoreErrorCode

  constructor(code: SupplyStoreErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = new.target.name
  }
}

export class RecordNotFoundError extends SupplyStoreError {
  readonly entity: string
  readonly recordId: string

  constructor(entity: string, recordId: string) {
    super('not_found', `[internal] ${entity} ${recordId} was not found in the requested scope`)
    this.entity = entity
    this.recordId = recordId
  }
}

export class DuplicateRfcMessageIdError extends SupplyStoreError {
  readonly rfcMessageId: string

  constructor(rfcMessageId: string) {
    super(
      'duplicate_rfc_message_id',
      `[internal] an InboundMessage with rfcMessageId ${rfcMessageId} already exists in this scope`,
    )
    this.rfcMessageId = rfcMessageId
  }
}

export class DuplicateRecordKeyError extends SupplyStoreError {
  readonly entity: string
  readonly field: string
  readonly value: string

  constructor(entity: string, field: string, value: string) {
    super('duplicate_record_key', `[internal] ${entity} with ${field} ${value} already exists in this scope`)
    this.entity = entity
    this.field = field
    this.value = value
  }
}

export class ScopeMismatchError extends SupplyStoreError {
  readonly entity: string

  constructor(entity: string) {
    super('scope_mismatch', `[internal] ${entity} payload carries a tenantId/organizationId outside the requested scope`)
    this.entity = entity
  }
}

export class AppendOnlyViolationError extends SupplyStoreError {
  readonly entity: string

  constructor(entity: string, operation: string) {
    super('append_only_violation', `[internal] ${entity} is append-only and cannot be ${operation}`)
    this.entity = entity
  }
}

export class StoreFileCorruptedError extends SupplyStoreError {
  readonly filePath: string

  constructor(filePath: string, reason: string) {
    super('store_file_corrupted', `[internal] store file ${filePath} is not readable: ${reason}`)
    this.filePath = filePath
  }
}

export class VersionConflictError extends SupplyStoreError {
  constructor(entity: string) {
    super('version_conflict', `[internal] ${entity} changed after it was read`)
  }
}

export class AlternativeOfferConflictError extends SupplyStoreError {
  constructor() {
    super('offer_conflict', '[internal] a different alternative offer is already recorded for this case')
  }
}

export function isSupplyStoreError(error: unknown): error is SupplyStoreError {
  return error instanceof SupplyStoreError
}
