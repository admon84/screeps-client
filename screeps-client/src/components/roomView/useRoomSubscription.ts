import { createEffect, onCleanup } from 'solid-js'
import { SubscriptionGroup } from 'screeps-connectivity'
import type { Badge, RoomObjectDiff, RoomObjectMap } from 'screeps-connectivity'
import { client, recordGameTime, setGameTime } from '~/stores/clientStore.js'
import { clearSelection } from '~/stores/selectionStore.js'
import { addToast } from '~/stores/toastStore.js'
import { setRoomUsers } from '~/stores/roomDataStore.js'
import { accumulateRoomStats, publishRoomStats, resetRoomStats } from './roomStats.js'
import { createLogger } from '~/utils/log.js'

const { log } = createLogger('room')

export type RoomUsers = Record<string, { _id: string; username: string; badge?: Badge }>

export interface RoomState {
  objects: RoomObjectMap
  diff?: RoomObjectDiff
  users?: RoomUsers
}

/**
 * Live room data over the WebSocket. Subscribes as soon as the client is ready -- deliberately
 * independent of any renderer instance, so the initial room state can arrive before rendering
 * has finished initializing.
 */
export function useRoomSubscription(opts: {
  room: () => string
  shard: () => string | null
  active: () => boolean
  onState: (state: RoomState, visual: string) => void
  onReset: () => void
}): void {
  createEffect(() => {
    const c = client()
    if (!c || !opts.active()) return

    const room = opts.room()
    const shard = opts.shard()

    log(`navigate → ${room} (shard=${shard ?? 'default'})`)
    opts.onReset()
    setGameTime(null)
    clearSelection()
    resetRoomStats()
    setRoomUsers(null)

    const group = new SubscriptionGroup()

    group.add(c.stores.room.subscribe(room, shard))
    group.add(c.stores.room.on('room:error', (data) => {
      addToast(`Room subscription error (${data.room}): ${data.message}`, 'error', 8000)
    }))
    group.add(c.stores.room.on('room:update', (data) => {
      const stats = accumulateRoomStats(data.objects, data.users)
      if (!data.diff) {
        log(`objects loaded — ${room}: ${stats.objectCount} objects, tick=${data.gameTime}`)
      }
      opts.onState({ objects: data.objects, diff: data.diff, users: data.users }, data.visual)
      setGameTime(data.gameTime ?? null)
      recordGameTime(data.gameTime)
      publishRoomStats(stats)
      setRoomUsers(data.users ?? null)
    }))

    onCleanup(() => {
      log(`leaving ${room}`)
      group.dispose()
    })
  })
}
