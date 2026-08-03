import { createEffect, createSignal, onCleanup, onMount, untrack, Show } from 'solid-js'
import { GameRoom } from '~/roomRenderer/GameRoom.js'
import { resourceMap } from '~/roomRenderer/resourceMap.js'
import { toGameData, toLighting } from '~/roomRenderer/adapters/settingsMapping.js'
import { withBadgeUrls } from '~/roomRenderer/adapters/badgeUrls.js'
import { client, gameTime, tickDuration, worldBounds, userInfo } from '~/stores/clientStore.js'
import { showCreepLabels, terrainEffects, roomDarkOverlay, smoothAnimations } from '~/stores/settingsStore.js'
import { historyMode, playbackSpeed } from '~/stores/historyStore.js'
import { roomViewMode, modeHint, resetRoomViewModeOnNavigate } from '~/stores/roomViewStore'
import { parseRoomName, formatRoomName, isRoomInWorld } from '~/utils/roomName.js'
import { useRoomNavigationKeys } from '~/utils/useRoomNavigationKeys.js'
import { useRoomSubscription, type RoomState } from '~/components/roomView/useRoomSubscription.js'
import { useRoomHistory } from '~/components/roomView/useRoomHistory.js'
import { useRoomTerrain } from '~/components/roomView/useRoomTerrain.js'
import { RoomHistorySlider } from '~/components/roomView/RoomHistorySlider.js'
import { DecorateHint, HistoryNoDataCard, ModeHintPill, TickBadge } from '~/components/roomView/RoomViewOverlays.js'
import { createLogger } from '~/utils/log.js'

const { log, error } = createLogger('room')

interface GameRoomViewerProps {
  room: string
  shard: string | null
  onNavigate?: (room: string, shard: string | null) => void
}

/**
 * Room view backed by the official @screeps/renderer engine (experimental, behind the
 * "Official room renderer" setting). Phase 3 scope: terrain, objects, animations, badges,
 * camera and room navigation -- tile interaction (selection, build, flags) follows.
 */
export function GameRoomViewer(props: GameRoomViewerProps) {
  let containerRef: HTMLDivElement | undefined
  const [gameRoom, setGameRoom] = createSignal<GameRoom | null>(null)
  const [objectState, setObjectState] = createSignal<RoomState | null>(null)

  const terrain = useRoomTerrain({
    room: () => props.room,
    shard: () => props.shard,
  })

  useRoomSubscription({
    room: () => props.room,
    shard: () => props.shard,
    active: () => !historyMode(),
    onReset: () => setObjectState(null),
    // RoomVisuals (the visual payload) are wired up in a later migration phase.
    onState: (state) => setObjectState(state),
  })

  const { historyNoData } = useRoomHistory({
    room: () => props.room,
    shard: () => props.shard,
    active: historyMode,
    onEnter: () => {},
    onState: setObjectState,
  })

  let disposed = false
  onMount(async () => {
    if (!containerRef) return
    const settings = untrack(() => ({
      showCreepLabels: showCreepLabels(),
      terrainEffects: terrainEffects(),
      roomDarkOverlay: roomDarkOverlay(),
      smoothAnimations: smoothAnimations(),
    }))
    try {
      const room = await GameRoom.create({
        container: containerRef,
        gameData: toGameData(settings, untrack(userInfo)?._id ?? ''),
        lighting: toLighting(settings),
        resourceMap,
      })
      if (disposed) {
        room.release()
        return
      }
      setGameRoom(room)
    } catch (err) {
      error('official renderer init failed:', err)
    }
  })

  onCleanup(() => {
    disposed = true
    gameRoom()?.release()
    setGameRoom(null)
  })

  // Room switch: drop the previous room's objects and reset the camera before the new
  // terrain and state arrive. Created before the terrain effect so a pre-loaded terrain
  // for the new room is applied after the erase.
  createEffect(() => {
    const g = gameRoom()
    if (!g) return
    void props.room
    void props.shard

    resetRoomViewModeOnNavigate()
    g.eraseObjects()
    g.camera.resetView()
    setupNavZones(g, untrack(worldBounds))
  })

  // Re-wire nav zones (and keyboard navigation) when worldBounds arrives after login.
  createEffect(() => {
    const g = gameRoom()
    if (!g) return
    const bounds = worldBounds()

    const nav = props.onNavigate
    if (nav) {
      useRoomNavigationKeys({
        currentRoom: () => props.room,
        worldBounds,
        onMove: (rx, ry) => nav(formatRoomName(rx, ry), props.shard),
      })
    }
    setupNavZones(g, bounds)
  })

  function setupNavZones(g: GameRoom, bounds: ReturnType<typeof worldBounds>): void {
    const room = untrack(() => props.room)
    const shard = untrack(() => props.shard)
    const nav = untrack(() => props.onNavigate)
    const coord = parseRoomName(room)
    if (!coord || !nav) return

    const canNavigate = (tx: number, ty: number) =>
      !bounds || isRoomInWorld(tx, ty, bounds)

    const navTo = (target: string) => {
      log(`navigate requested: ${room} → ${target}`)
      nav(target, shard)
    }

    g.camera.setupNavigationZones({
      west:  canNavigate(coord.x - 1, coord.y) ? () => navTo(formatRoomName(coord.x - 1, coord.y)) : undefined,
      east:  canNavigate(coord.x + 1, coord.y) ? () => navTo(formatRoomName(coord.x + 1, coord.y)) : undefined,
      north: canNavigate(coord.x, coord.y - 1) ? () => navTo(formatRoomName(coord.x, coord.y - 1)) : undefined,
      south: canNavigate(coord.x, coord.y + 1) ? () => navTo(formatRoomName(coord.x, coord.y + 1)) : undefined,
    })
  }

  // Apply terrain whenever it changes (fetches resolve after the room-switch erase).
  createEffect(() => {
    const g = gameRoom()
    const t = terrain()
    if (!g || !t || t.room !== props.room) return
    log(`terrain applied — ${props.room}`)
    g.applyTerrain(t.room, t.data)
  })

  // Apply object state every tick. The renderer diffs full object arrays itself (omission
  // means removal), so no diff path is needed; beams, say bubbles and creep interpolation
  // are native to the renderer's metadata processors.
  createEffect(() => {
    const g = gameRoom()
    const state = objectState()
    if (!g) return
    if (!state) {
      g.eraseObjects()
      return
    }

    const tickMs = historyMode()
      ? Math.round(1000 / untrack(playbackSpeed))
      : (tickDuration() ?? 2000)
    const instant = historyMode() || !smoothAnimations()
    const users = withBadgeUrls(state.users, badgeUrlTemplate())
    g.applyState(state.objects, users, gameTime() ?? undefined, instant ? 0 : tickMs / 1000)
  })

  function badgeUrlTemplate(): string {
    const base = untrack(client)?.http.baseUrl ?? '/'
    return `${base}api/user/badge-svg?username=%1`
  }

  const hint = () => roomViewMode() === 'decorate' ? <DecorateHint /> : modeHint()

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={(el) => containerRef = el} style={{ width: '100%', height: '100%' }} />
      {hint() && <ModeHintPill hint={hint()} />}
      <TickBadge />
      <Show when={historyMode() && historyNoData()}>
        <HistoryNoDataCard />
      </Show>
      <Show when={historyMode()}>
        <RoomHistorySlider />
      </Show>
    </div>
  )
}
