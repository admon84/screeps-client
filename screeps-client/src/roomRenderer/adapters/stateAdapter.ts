import type { RoomObjectMap } from 'screeps-connectivity'
import type { ObjectState, State, StateUser } from '@screeps/renderer'

/**
 * Builds a fresh state envelope for GameRenderer.applyState. The renderer MUTATES the passed
 * state (injects gameData) and retains object references as prevState, so every object is
 * shallow-copied -- never hand it store-owned data.
 */
export function toRendererState(
  objects: RoomObjectMap,
  users: Record<string, StateUser>,
  gameTime: number | undefined,
): State {
  const list: ObjectState[] = []
  for (const id in objects) list.push({ ...objects[id] })
  return { objects: list, users, gameTime, info: {}, flags: [], visual: '' }
}
