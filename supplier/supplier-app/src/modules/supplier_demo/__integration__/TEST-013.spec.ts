import { spawn } from 'node:child_process'
import { test, expect } from '@playwright/test'

type CliResult = {
  code: number
  stdout: string
  stderr: string
}

function runSupplierDemoCli(command: string): Promise<CliResult> {
  const executable = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['mercato', 'supplier_demo', command], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SUPPLIER_DEMO_PARTNER_EMAILS: process.env.SUPPLIER_DEMO_PARTNER_EMAILS ?? 'manufacturer-a@example.test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

test('TEST-013 setup and demo preflight remain idempotent', async () => {
  const firstReset = await runSupplierDemoCli('demo:reset')
  expect(firstReset.code, firstReset.stderr).toBe(0)

  const secondReset = await runSupplierDemoCli('demo:reset')
  expect(secondReset.code, secondReset.stderr).toBe(0)

  const preflight = await runSupplierDemoCli('demo:preflight')
  const preflightOutput = `${preflight.stdout}\n${preflight.stderr}`
  expect(preflightOutput).toContain('queue strategy:')
  if (preflight.code === 0) {
    expect(preflight.stdout).toContain('Supplier demo preflight passed.')
  } else {
    expect(preflightOutput).toContain('Remediation:')
  }
})
