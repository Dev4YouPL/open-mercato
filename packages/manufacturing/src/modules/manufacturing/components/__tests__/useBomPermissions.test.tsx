/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

import { useBomPermissions } from '../useBomPermissions'

/**
 * The list and editor pages only require `manufacturing.bom.view`, so a viewer
 * can open them. Write affordances must be hidden rather than offered and
 * rejected (spec ACL / US-BOM-31), and the decision must fail closed — while
 * the grant check is still in flight, when it errors, and when the grant set
 * comes back empty.
 */

const MANAGE = 'manufacturing.bom.manage'

function Probe({ onRender }: { onRender: (value: { canManage: boolean; isLoading: boolean }) => void }) {
  const permissions = useBomPermissions()
  onRender(permissions)
  return (
    <output data-testid="state">
      {permissions.isLoading ? 'loading' : permissions.canManage ? 'manage' : 'view-only'}
    </output>
  )
}

function renderProbe() {
  const states: Array<{ canManage: boolean; isLoading: boolean }> = []
  const view = render(<Probe onRender={(value) => states.push(value)} />)
  return { ...view, states }
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('useBomPermissions', () => {
  it('asks the platform feature-check endpoint for the manage feature exactly once', async () => {
    apiCallMock.mockResolvedValue({ result: { granted: [MANAGE] } })

    const { findByText } = renderProbe()
    await findByText('manage')

    expect(apiCallMock).toHaveBeenCalledTimes(1)
    const [path, init] = apiCallMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/auth/feature-check')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ features: [MANAGE] })
  })

  it('fails closed while the grant check is still in flight', async () => {
    let release: (value: unknown) => void = () => {}
    apiCallMock.mockReturnValue(new Promise((resolve) => { release = resolve }))

    const { states, findByText } = renderProbe()

    expect(states[0]).toEqual({ canManage: false, isLoading: true })
    await act(async () => { release({ result: { granted: [MANAGE] } }) })
    await findByText('manage')
  })

  it('honours a wildcard grant rather than requiring the literal feature string', async () => {
    apiCallMock.mockResolvedValue({ result: { granted: ['manufacturing.*'] } })

    const { findByText } = renderProbe()

    await findByText('manage')
  })

  it('denies management when only the view feature is granted', async () => {
    apiCallMock.mockResolvedValue({ result: { granted: ['manufacturing.bom.view'] } })

    const { findByText } = renderProbe()

    await findByText('view-only')
  })

  it('denies management when an unrelated module wildcard is granted', async () => {
    apiCallMock.mockResolvedValue({ result: { granted: ['catalog.*'] } })

    const { findByText } = renderProbe()

    await findByText('view-only')
  })

  it('fails closed when the grant check errors', async () => {
    apiCallMock.mockRejectedValue(new Error('[internal] feature check unavailable'))

    const { findByText } = renderProbe()

    await findByText('view-only')
  })

  it('fails closed when the response carries no grant list at all', async () => {
    apiCallMock.mockResolvedValue({})

    const { findByText } = renderProbe()

    await findByText('view-only')
  })

  it('does not set state after the component unmounts', async () => {
    let release: (value: unknown) => void = () => {}
    apiCallMock.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const { unmount, states } = renderProbe()
    const renderCountAtUnmount = states.length
    unmount()
    await act(async () => { release({ result: { granted: [MANAGE] } }) })

    await waitFor(() => expect(states).toHaveLength(renderCountAtUnmount))
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
