import { describe, it, expect } from 'vitest'
import type { ApiRoomDecorationItem } from 'screeps-connectivity'
import { toRendererDecorations } from '../../src/roomRenderer/adapters/decorationAdapter'

const graffiti: ApiRoomDecorationItem = {
  _id: 'd1',
  user: 'u1',
  active: {
    x: '12',
    y: '34.5',
    width: '3',
    height: '2',
    rotation: '1.5707',
    alpha: '0.8',
    flip: 'true',
    lighting: 'false',
    animation: 'neon',
    foregroundColor: '#3333ff',
    room: 'W1N1',
    shard: 'shard3',
  },
  decoration: { _id: 'def1', type: 'wallGraffiti', foregroundUrl: 'decorations/art.png' },
}

describe('toRendererDecorations()', () => {
  it('flattens active props onto the root with numeric and boolean coercion', () => {
    const [item] = toRendererDecorations([graffiti])
    expect(item).toMatchObject({
      _id: 'd1',
      user: 'u1',
      x: 12,
      y: 34.5,
      width: 3,
      height: 2,
      rotation: 1.5707,
      alpha: 0.8,
      flip: true,
      lighting: false,
      animation: 'neon',
      foregroundColor: '#3333ff',
      room: 'W1N1',
      shard: 'shard3',
    })
    expect(item.decoration.type).toBe('wallGraffiti')
    expect('active' in item).toBe(false)
  })

  it('resolves decoration graphic URLs', () => {
    const withGraphics: ApiRoomDecorationItem = {
      ...graffiti,
      decoration: {
        _id: 'def2',
        type: 'landscape',
        floorForegroundUrl: 'decorations/floor.png',
        graphics: [{ url: 'decorations/g1.png', color: 'foregroundColor' }],
      },
    }
    const [item] = toRendererDecorations([withGraphics], (url) => `https://cdn/${url}`)
    expect(item.decoration.floorForegroundUrl).toBe('https://cdn/decorations/floor.png')
    expect(item.decoration.graphics).toEqual([{ url: 'https://cdn/decorations/g1.png', color: 'foregroundColor' }])
  })

  it('does not mutate the API items', () => {
    toRendererDecorations([graffiti], (url) => `x/${url}`)
    expect(graffiti.active.x).toBe('12')
    expect(graffiti.decoration.foregroundUrl).toBe('decorations/art.png')
  })
})
