import { describe, it, expect } from 'vitest'
import type { RoomObjectMap } from 'screeps-connectivity'
import { toRendererState } from '../../src/roomRenderer/adapters/stateAdapter'

describe('toRendererState()', () => {
  const objects: RoomObjectMap = {
    a: { _id: 'a', type: 'creep', room: 'W1N1', x: 10, y: 20, user: 'u1' },
    b: { _id: 'b', type: 'spawn', room: 'W1N1', x: 25, y: 25, user: 'u1' },
  }

  it('flattens the map into an array of copies', () => {
    const state = toRendererState(objects, {}, 12345)
    expect(state.objects).toHaveLength(2)
    expect(state.objects).toContainEqual(objects.a)
    expect(state.objects).toContainEqual(objects.b)
  })

  it('never emits store-owned references (applyState mutates and retains state)', () => {
    const state = toRendererState(objects, {}, 1)
    for (const obj of state.objects) {
      expect(obj).not.toBe(objects[obj._id as string])
    }
    const again = toRendererState(objects, {}, 2)
    expect(again).not.toBe(state)
    expect(again.objects[0]).not.toBe(state.objects[0])
  })

  it('builds the full envelope', () => {
    const users = { u1: { username: 'alice' } }
    const state = toRendererState({}, users, 777)
    expect(state).toEqual({ objects: [], users, gameTime: 777, info: {}, flags: [], visual: '' })
  })
})
