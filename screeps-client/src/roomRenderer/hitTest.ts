import type { RoomObject, RoomObjectMap } from 'screeps-connectivity'

/**
 * Store-data replacement for ObjectLayer.getObjectsAtTile: creeps match on their target (data)
 * position, not the interpolated visual position, so selection stays consistent mid-move.
 */
export function objectsAtTile(objects: RoomObjectMap, tx: number, ty: number): RoomObject[] {
  const result: RoomObject[] = []
  for (const id in objects) {
    const obj = objects[id]
    if (obj.x === tx && obj.y === ty) result.push(obj)
  }
  return result
}
