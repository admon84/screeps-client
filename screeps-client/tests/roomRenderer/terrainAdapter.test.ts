import { describe, it, expect } from 'vitest'
import { RoomTerrain, TerrainType } from 'screeps-connectivity'
import { toRendererTerrain } from '../../src/roomRenderer/adapters/terrainAdapter'

function terrainWith(tiles: Array<{ x: number; y: number; type: TerrainType }>): RoomTerrain {
  const data = new Uint8Array(2500)
  for (const { x, y, type } of tiles) data[y * 50 + x] = type
  return new RoomTerrain(data)
}

describe('toRendererTerrain()', () => {
  it('emits sparse entries for walls and swamps only', () => {
    const terrain = terrainWith([
      { x: 0, y: 0, type: TerrainType.Wall },
      { x: 5, y: 3, type: TerrainType.Swamp },
      { x: 49, y: 49, type: TerrainType.Wall },
    ])
    expect(toRendererTerrain('W1N1', terrain)).toEqual([
      { room: 'W1N1', x: 0, y: 0, type: 'wall' },
      { room: 'W1N1', x: 5, y: 3, type: 'swamp' },
      { room: 'W1N1', x: 49, y: 49, type: 'wall' },
    ])
  })

  it('returns an empty array for an all-plain room', () => {
    expect(toRendererTerrain('W1N1', terrainWith([]))).toEqual([])
  })

  it('maps encoded-string terrain including the wall+swamp value 3', () => {
    const encoded = '3' + '2'.repeat(49) + '0'.repeat(2450)
    const result = toRendererTerrain('E0S0', RoomTerrain.fromEncodedString(encoded))
    expect(result[0]).toEqual({ room: 'E0S0', x: 0, y: 0, type: 'wall' })
    expect(result).toHaveLength(50)
    expect(result.slice(1).every((t) => t.type === 'swamp' && t.y === 0)).toBe(true)
  })
})
