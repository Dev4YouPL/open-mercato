import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function readCoreFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'node_modules/@open-mercato/core', relativePath), 'utf8')
}

describe('inbound mailbox routing patch', () => {
  it('routes inbound messages to the assigned user or channel owner', () => {
    const source = readCoreFile('src/modules/communication_channels/commands/ingest-inbound-message.ts')
    const compiled = readCoreFile('dist/modules/communication_channels/commands/ingest-inbound-message.js')

    expect(source).toContain("const inboundRecipientUserId = input.channelType === 'email' && contactHint?.email")
    expect(source).toContain("visibility: inboundRecipientUserId ? 'internal' as const : 'public' as const")
    expect(source).toContain('recipients: inboundRecipientUserId')
    expect(source).toContain('inboundRecipientUserId,')
    expect(compiled).toContain('const inboundRecipientUserId = input.channelType === "email" && contactHint?.email')
    expect(compiled).toContain('visibility: inboundRecipientUserId ? "internal" : "public"')
    expect(compiled).toContain('recipients: inboundRecipientUserId ? [{ userId: inboundRecipientUserId, type: "to" }] : []')
    expect(compiled).toContain('inboundRecipientUserId')
  })
})
