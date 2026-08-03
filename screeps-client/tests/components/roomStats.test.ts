import { describe, it, expect } from 'vitest'
import type { RoomObjectMap } from 'screeps-connectivity'
import { accumulateRoomStats } from '../../src/components/roomView/roomStats'

describe('accumulateRoomStats()', () => {
  const objects: RoomObjectMap = {
    c1: { _id: 'c1', type: 'creep', room: 'W1N1', x: 1, y: 1 },
    s1: { _id: 's1', type: 'spawn', room: 'W1N1', x: 2, y: 2 },
    s2: { _id: 's2', type: 'extension', room: 'W1N1', x: 3, y: 3 },
    cs1: { _id: 'cs1', type: 'constructionSite', room: 'W1N1', x: 4, y: 4, structureType: 'extension' },
    ctrl: {
      _id: 'ctrl', type: 'controller', room: 'W1N1', x: 25, y: 25,
      user: 'u1', level: 6, progress: 12345,
    },
  }

  it('counts objects and structures, folding construction sites into their structure type', () => {
    const stats = accumulateRoomStats(objects)
    expect(stats.objectCount).toBe(5)
    expect(stats.structCounts).toEqual({ creep: 1, spawn: 1, extension: 2, controller: 1 })
  })

  it('extracts controller owner, level and progress, resolving the username', () => {
    const stats = accumulateRoomStats(objects, { u1: { username: 'alice' } })
    expect(stats.owner).toEqual({ userId: 'u1', username: 'alice' })
    expect(stats.controllerLevel).toBe(6)
    expect(stats.controllerProgress).toBe(12345)
  })

  it('falls back to the user id when the users map has no entry', () => {
    expect(accumulateRoomStats(objects).owner).toEqual({ userId: 'u1', username: 'u1' })
  })

  it('extracts a reservation on unowned controllers', () => {
    const reserved: RoomObjectMap = {
      ctrl: {
        _id: 'ctrl', type: 'controller', room: 'W1N1', x: 25, y: 25,
        reservation: { user: 'u2', endTime: 99999 },
      },
    }
    const stats = accumulateRoomStats(reserved)
    expect(stats.owner).toBeNull()
    expect(stats.reservation).toEqual({ user: 'u2', endTime: 99999 })
  })

  it('handles an empty room', () => {
    expect(accumulateRoomStats({})).toEqual({
      objectCount: 0, structCounts: {}, owner: null,
      controllerLevel: 0, controllerProgress: null, reservation: null,
    })
  })
})
