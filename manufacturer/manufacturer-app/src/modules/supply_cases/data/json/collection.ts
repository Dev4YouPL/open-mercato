import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import { StoreFileCorruptedError } from '../errors'
import { STORE_FILE_VERSION, storeFileSchema } from '../types'

export type AtomicWriter = (filePath: string, contents: string) => Promise<void>

/**
 * Writes through a temporary file so an interrupted write leaves the previous
 * valid JSON in place: the rename is the only step that makes new content
 * visible, and the fsync before it guarantees the renamed file is complete
 * rather than an empty or truncated placeholder.
 */
export const writeFileAtomically: AtomicWriter = async (filePath, contents) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  let renamed = false
  try {
    const handle = await fs.open(tempPath, 'w')
    try {
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(tempPath, filePath)
    renamed = true
  } finally {
    if (!renamed) {
      await fs.rm(tempPath, { force: true })
    }
  }
}

export type JsonCollectionOptions<TRecord> = {
  filePath: string
  recordSchema: z.ZodType<TRecord>
  writer?: AtomicWriter
}

export type MutationOutcome<TRecord, TResult> = {
  records: TRecord[]
  result: TResult
}

/**
 * One JSON file holding one record type. Mutations are serialized per
 * collection because every write is a read-modify-write cycle: two concurrent
 * creates would otherwise read the same snapshot and the later write would
 * silently drop the earlier record. Uniqueness checks therefore belong inside
 * the mutator, which runs inside the same critical section as the write.
 */
export class JsonCollection<TRecord> {
  private readonly filePath: string
  private readonly recordSchema: z.ZodType<TRecord>
  private readonly writer: AtomicWriter
  private pending: Promise<unknown> = Promise.resolve()

  constructor(options: JsonCollectionOptions<TRecord>) {
    this.filePath = options.filePath
    this.recordSchema = options.recordSchema
    this.writer = options.writer ?? writeFileAtomically
  }

  async readAll(): Promise<TRecord[]> {
    let raw: string
    try {
      raw = await fs.readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new StoreFileCorruptedError(this.filePath, (error as Error).message)
    }

    const envelope = storeFileSchema(this.recordSchema).safeParse(parsed)
    if (!envelope.success) {
      throw new StoreFileCorruptedError(this.filePath, envelope.error.issues.map((issue) => issue.message).join('; '))
    }
    return envelope.data.records
  }

  async mutate<TResult>(
    mutator: (records: TRecord[]) => MutationOutcome<TRecord, TResult> | Promise<MutationOutcome<TRecord, TResult>>,
  ): Promise<TResult> {
    const run = async (): Promise<TResult> => {
      const records = await this.readAll()
      const outcome = await mutator(records)
      await this.persist(outcome.records)
      return outcome.result
    }

    // Chain onto the previous mutation whether it settled or rejected, so one
    // failed write does not wedge the collection.
    const next = this.pending.then(run, run)
    this.pending = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async persist(records: TRecord[]): Promise<void> {
    const contents = `${JSON.stringify({ version: STORE_FILE_VERSION, records }, null, 2)}\n`
    await this.writer(this.filePath, contents)
  }
}
