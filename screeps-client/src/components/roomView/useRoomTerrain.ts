import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js'
import type { RoomTerrain } from 'screeps-connectivity'
import { client } from '~/stores/clientStore.js'
import { setCurrentRoom, setCurrentShard } from '~/stores/roomDataStore.js'
import { createLogger } from '~/utils/log.js'

const { log, error } = createLogger('room')

/**
 * Terrain for the current room, plus the current-room/shard publication. Deliberately
 * independent of history mode: entering history mode must not cancel an in-flight terrain
 * fetch (a fresh page reload straight into history mode still needs terrain).
 */
export function useRoomTerrain(opts: {
  room: () => string
  shard: () => string | null
}): Accessor<{ room: string; data: RoomTerrain } | null> {
  const [terrain, setTerrain] = createSignal<{ room: string; data: RoomTerrain } | null>(null)

  createEffect(() => {
    const c = client()
    if (!c) return

    const room = opts.room()
    const shard = opts.shard()

    setTerrain(null)
    setCurrentRoom(room)
    setCurrentShard(shard)

    let cancelled = false
    c.stores.room.terrain(room, shard)
      .then((t) => {
        if (!cancelled) {
          log(`terrain loaded — ${room}`)
          setTerrain({ room, data: t })
        }
      })
      .catch((err) => { if (!cancelled) error(`terrain load failed for ${room}:`, err) })

    onCleanup(() => { cancelled = true })
  })

  return terrain
}
