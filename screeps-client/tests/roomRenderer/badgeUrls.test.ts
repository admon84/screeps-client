import { describe, it, expect } from 'vitest'
import type { Badge } from 'screeps-connectivity'
import { svgDataUrl, withBadgeUrls } from '../../src/roomRenderer/adapters/badgeUrls'

const badge: Badge = { type: 1, color1: '#ff0000', color2: '#00ff00', color3: '#0000ff', param: 0, flip: false }
const TEMPLATE = 'api/user/badge-svg?username=%1'

describe('withBadgeUrls()', () => {
  it('renders badge objects as inline SVG data URLs', () => {
    const users = withBadgeUrls({ u1: { _id: 'u1', username: 'alice', badge } }, TEMPLATE)
    expect(users.u1.badgeUrl).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(users.u1.badgeUrl!)).toContain('<svg')
    expect(users.u1.username).toBe('alice')
  })

  it('falls back to the endpoint template when the badge object is missing', () => {
    const users = withBadgeUrls({ u2: { _id: 'u2', username: 'bob smith' } }, TEMPLATE)
    expect(users.u2.badgeUrl).toBe('api/user/badge-svg?username=bob%20smith')
  })

  it('copies user entries instead of mutating the store map', () => {
    const input = { u1: { _id: 'u1', username: 'alice', badge } }
    const users = withBadgeUrls(input, TEMPLATE)
    expect(users.u1).not.toBe(input.u1)
    expect('badgeUrl' in input.u1).toBe(false)
  })

  it('handles undefined users', () => {
    expect(withBadgeUrls(undefined, TEMPLATE)).toEqual({})
  })
})

describe('svgDataUrl()', () => {
  it('percent-encodes the payload', () => {
    expect(svgDataUrl('<svg a="b"/>')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%22b%22%2F%3E')
  })
})
