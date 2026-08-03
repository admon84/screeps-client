import { TerrainType, type RoomTerrain } from 'screeps-connectivity'
import type { TerrainState } from '@screeps/renderer'
import { ROOM_SIZE } from '../worldConfigs.js'

/** Sparse array as setTerrain expects: plain tiles are simply absent. */
export function toRendererTerrain(room: string, terrain: RoomTerrain): TerrainState[] {
  const result: TerrainState[] = []
  for (let y = 0; y < ROOM_SIZE; y++) {
    for (let x = 0; x < ROOM_SIZE; x++) {
      const type = terrain.get(x, y)
      if (type === TerrainType.Wall) result.push({ room, x, y, type: 'wall' })
      else if (type === TerrainType.Swamp) result.push({ room, x, y, type: 'swamp' })
    }
  }
  return result
}
