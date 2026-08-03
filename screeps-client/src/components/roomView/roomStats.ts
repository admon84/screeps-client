import type { RoomObjectMap } from 'screeps-connectivity'
import {
  setControllerLevel, setControllerProgress, setControllerReservation,
  setRoomObjectCount, setRoomOwner, setStructureCounts,
} from '~/stores/roomDataStore.js'

export interface RoomStats {
  objectCount: number
  structCounts: Record<string, number>
  owner: { userId: string; username: string } | null
  controllerLevel: number
  controllerProgress: number | null
  reservation: { user: string; endTime: number } | null
}

/**
 * Single for...in pass: count objects, sum structures, extract controller owner --
 * avoids allocating Object.values() / Object.entries() arrays on the hot path.
 */
export function accumulateRoomStats(
  objects: RoomObjectMap,
  users?: Record<string, { username: string }>,
): RoomStats {
  let objectCount = 0
  const structCounts: Record<string, number> = {}
  let controllerLevel = 0
  let controllerProgress: number | null = null
  let owner: { userId: string; username: string } | null = null
  let reservation: { user: string; endTime: number } | null = null

  for (const id in objects) {
    objectCount++
    const obj = objects[id]
    if (!obj) continue

    const objType = obj.type
    if (typeof objType === 'string') {
      if (objType === 'constructionSite') {
        const structureType = obj.structureType
        if (typeof structureType === 'string') {
          structCounts[structureType] = (structCounts[structureType] || 0) + 1
        }
      } else {
        structCounts[objType] = (structCounts[objType] || 0) + 1
      }
    }

    if (objType === 'controller') {
      if (typeof obj.user === 'string') {
        const userId = obj.user
        const username = users?.[userId]?.username ?? userId
        owner = { userId, username }
        if (typeof obj.level === 'number') controllerLevel = obj.level
        if (typeof obj.progress === 'number') controllerProgress = obj.progress
      }
      const res = obj.reservation as { user: string; endTime: number } | undefined
      if (res && typeof res.user === 'string' && typeof res.endTime === 'number') {
        reservation = { user: res.user, endTime: res.endTime }
      }
    }
  }

  return { objectCount, structCounts, owner, controllerLevel, controllerProgress, reservation }
}

/** Back to the loading state (null), distinct from an empty room (0 / {}). */
export function resetRoomStats(): void {
  setRoomObjectCount(null)
  setRoomOwner(null)
  setControllerLevel(null)
  setControllerProgress(null)
  setControllerReservation(null)
  setStructureCounts({})
}

export function publishRoomStats(stats: RoomStats): void {
  setRoomObjectCount(stats.objectCount)
  setRoomOwner(stats.owner)
  setControllerLevel(stats.controllerLevel || null)
  setControllerProgress(stats.controllerProgress)
  setControllerReservation(stats.reservation)
  setStructureCounts(stats.structCounts)
}
