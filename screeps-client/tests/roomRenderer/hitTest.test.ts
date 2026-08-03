import { describe, it, expect } from 'vitest'
import type { RoomObjectMap } from 'screeps-connectivity'
import { objectsAtTile } from '../../src/roomRenderer/hitTest'

describe('objectsAtTile()', () => {
  const objects: RoomObjectMap = {
    creep1: { _id: 'creep1', type: 'creep', room: 'W1N1', x: 10, y: 10 },
    road1: { _id: 'road1', type: 'road', room: 'W1N1', x: 10, y: 10 },
    spawn1: { _id: 'spawn1', type: 'spawn', room: 'W1N1', x: 25, y: 25 },
  }

  it('returns all objects on the tile', () => {
    const hits = objectsAtTile(objects, 10, 10)
    expect(hits.map((o) => o._id).sort()).toEqual(['creep1', 'road1'])
  })

  it('returns an empty array for an empty tile', () => {
    expect(objectsAtTile(objects, 0, 0)).toEqual([])
  })
})
