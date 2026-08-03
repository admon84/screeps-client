import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js'
import type { ApiRoomDecorationItem } from 'screeps-connectivity'
import { client } from '~/stores/clientStore.js'
import { decorationsRevision, setRoomDecorationItems } from '~/stores/roomDataStore.js'
import { mergeDecorationItems } from '~/renderer/roomDecorations.js'
import { createLogger } from '~/utils/log.js'

const { log } = createLogger('room')

export interface RoomDecorationItems {
  room: string
  items: readonly ApiRoomDecorationItem[]
}

/**
 * Raw decoration items for a room: HTTP fetch merged with whatever room ticks carry over the
 * socket, keyed by `_id`. Raw items are also published to roomDataStore for the sidebar and
 * the creep properties panel.
 */
export function useRoomDecorationItems(opts: {
  room: () => string
  shard: () => string | null
  enabled: () => boolean
}): Accessor<RoomDecorationItems | null> {
  const [decorationItems, setDecorationItems] = createSignal<RoomDecorationItems | null>(null)
  // Items that arrived over the socket while an HTTP read was in flight. Only those are
  // layered back on top of the response — carrying every earlier socket item over would
  // keep a decoration that has since been taken down alive until the next room change.
  let socketItemsSinceFetch: ApiRoomDecorationItem[] = []

  // Clear on room change and when the setting is turned off.
  createEffect(() => {
    void client()
    void opts.room()
    void opts.shard()
    void opts.enabled()
    setDecorationItems(null)
  })

  // Decorations are fetched in their own effect so that switching the setting back on
  // re-fetches immediately instead of waiting for the next room change.
  createEffect(() => {
    const c = client()
    if (!c || !opts.enabled()) return

    const room = opts.room()
    const shard = opts.shard()
    // Re-read after this client placed or removed a decoration. The room socket only
    // carries decorations when the server volunteers them, so an activation made from
    // the inventory would otherwise stay invisible until the room was reloaded.
    void decorationsRevision()

    let cancelled = false
    socketItemsSinceFetch = []
    c.http.game.roomDecorations(room, shard)
      .then((resp) => {
        if (!cancelled) {
          log(`decorations loaded — ${room}: ${resp.decorations.length} item(s)`)
          // The response is authoritative, so removals take effect; a room tick that
          // landed while it was in flight is layered back on top rather than dropped.
          const items = mergeDecorationItems(resp.decorations, socketItemsSinceFetch)
          socketItemsSinceFetch = []
          setDecorationItems({ room, items })
        }
      })
      .catch((err) => { if (!cancelled) log(`no decorations for ${room}: ${err}`) })

    onCleanup(() => { cancelled = true })
  })

  // Room ticks can carry decoration changes. Merge them into whatever the HTTP fetch
  // returned; the merge keeps the previous array when nothing actually differs, so a
  // server that repeats the payload every tick doesn't rebuild consumers.
  createEffect(() => {
    const c = client()
    if (!c || !opts.enabled()) return

    const room = opts.room()
    const shard = opts.shard()

    const sub = c.stores.room.on('room:decorations', (data) => {
      if (data.room !== room || data.shard !== shard) return
      socketItemsSinceFetch.push(...data.decorations)
      setDecorationItems((prev) => {
        const current = prev?.room === room ? prev.items : []
        const merged = mergeDecorationItems(current, data.decorations)
        if (prev?.room === room && merged === current) return prev
        log(`decorations updated via socket — ${room}: ${merged.length} item(s)`)
        return { room, items: merged }
      })
    })

    onCleanup(() => sub.dispose())
  })

  // Publish the raw items for the sidebar and the creep properties panel.
  createEffect(() => {
    const raw = decorationItems()
    setRoomDecorationItems(raw?.room === opts.room() ? raw.items : [])
  })

  return decorationItems
}
