import { createEffect, createSignal, onCleanup, untrack, type Accessor } from 'solid-js'
import { client, isPrivateServer, serverVersion, setGameTime } from '~/stores/clientStore.js'
import { roomUsers } from '~/stores/roomDataStore.js'
import { addToast } from '~/stores/toastStore.js'
import {
  historyMaxTick, historyTick, isPlaying, pausePlayback,
  seekToTick, setHistoryLoading, setHistoryMaxTick,
} from '~/stores/historyStore.js'
import { HistoryPlayer, HistoryUnavailableError } from '~/stores/HistoryPlayer.js'
import { accumulateRoomStats, publishRoomStats } from './roomStats.js'
import type { RoomState } from './useRoomSubscription.js'

/**
 * History mode: fetch tick state over HTTP instead of the WebSocket. Returns the "no data for
 * this tick" flag (a 404 shows an in-room hint rather than a failure toast).
 */
export function useRoomHistory(opts: {
  room: () => string
  shard: () => string | null
  active: () => boolean
  onState: (state: RoomState) => void
  onEnter: () => void
}): { historyNoData: Accessor<boolean> } {
  const [historyNoData, setHistoryNoData] = createSignal(false)

  createEffect(() => {
    const c = client()
    if (!c || !opts.active()) return

    opts.onEnter()

    const room = opts.room()
    const shard = opts.shard()
    const isPriv = isPrivateServer() ?? true
    const chunkSize = serverVersion()?.serverData?.historyChunkSize ?? (isPriv ? 20 : 100)
    const cachedUsers = untrack(roomUsers) ?? undefined

    const player = new HistoryPlayer(room, shard, c.http, chunkSize)

    createEffect(() => {
      const tick = historyTick()
      let cancelled = false
      setHistoryLoading(true)

      player.getStateAtTick(tick)
        .then((state) => {
          if (cancelled) return
          setHistoryLoading(false)
          setHistoryNoData(false)
          // If the requested chunk didn't exist yet, clamp the history range down
          if (state.clampedTo !== undefined) {
            setHistoryMaxTick(state.clampedTo)
            seekToTick(state.clampedTo)
            return
          }
          opts.onState({ objects: state.objects, diff: undefined, users: cachedUsers })
          setGameTime(state.gameTime)
          publishRoomStats(accumulateRoomStats(state.objects, cachedUsers))
        })
        .catch((err: Error) => {
          if (cancelled) return
          setHistoryLoading(false)
          // No data for this tick (404): show an in-room hint instead of a failure toast.
          if (err instanceof HistoryUnavailableError) {
            setHistoryNoData(true)
            // While playing, don't re-fetch the same missing chunk file on every tick —
            // skip to the start of the next chunk in one hop. Stop if there's none left.
            if (isPlaying()) {
              const nextBase = player.chunkBase(tick) + chunkSize
              if (nextBase <= historyMaxTick()) {
                seekToTick(nextBase)
              } else {
                pausePlayback()
              }
            }
            return
          }
          setHistoryNoData(false)
          addToast(`History load failed for tick ${tick}: ${err.message}`, 'error', 5000)
        })

      onCleanup(() => { cancelled = true })
    })

    // Reset the "no data" hint when leaving history mode / changing room.
    onCleanup(() => setHistoryNoData(false))
  })

  return { historyNoData }
}
