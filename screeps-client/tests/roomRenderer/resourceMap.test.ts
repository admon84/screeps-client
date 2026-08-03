import { describe, it, expect } from 'vitest'
import { resourceMap } from '../../src/roomRenderer/resourceMap'

// Aliases the metadata resolves implicitly (layer afterCreate hooks, terrain noise, creep
// masking, effects) -- missing any of these fails at render time, not at type-check time.
const REQUIRED_ALIASES = [
  'noise1',
  'noise2',
  'exit-left',
  'exit-right',
  'exit-top',
  'exit-bottom',
  'ground',
  'ground-mask',
  'creep-mask',
  'glow',
  'flare1',
  'flare2',
  'flare3',
]

describe('resourceMap', () => {
  it('resolves every alias to a bundled asset URL', () => {
    const entries = Object.entries(resourceMap)
    expect(entries.length).toBeGreaterThanOrEqual(119)
    for (const [alias, url] of entries) {
      expect(url, alias).toBeTypeOf('string')
      expect(url.length, alias).toBeGreaterThan(0)
    }
  })

  it('contains the aliases the metadata resolves implicitly', () => {
    for (const alias of REQUIRED_ALIASES) {
      expect(resourceMap[alias], alias).toBeDefined()
    }
  })
})
