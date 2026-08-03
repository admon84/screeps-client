import { createEffect, createMemo, createSignal, onCleanup, untrack, Show } from 'solid-js'
import { GameRoom } from '~/roomRenderer/GameRoom.js'
import { resourceMap } from '~/roomRenderer/resourceMap.js'
import { CELL_SIZE } from '~/roomRenderer/worldConfigs.js'
import { toGameData, toLighting } from '~/roomRenderer/adapters/settingsMapping.js'
import { withBadgeUrls } from '~/roomRenderer/adapters/badgeUrls.js'
import { objectsAtTile } from '~/roomRenderer/hitTest.js'
import { toRendererDecorations } from '~/roomRenderer/adapters/decorationAdapter.js'
import { decorationTextureUrl } from '~/renderer/decorationTextureUrl.js'
import { mergeDecorationItems } from '~/renderer/roomDecorations.js'
import { client, gameTime, tickDuration, worldBounds, userInfo } from '~/stores/clientStore.js'
import { showCreepLabels, terrainEffects, roomDarkOverlay, smoothAnimations, showRoomVisuals, showRoomDecorations } from '~/stores/settingsStore.js'
import { historyMode, playbackSpeed } from '~/stores/historyStore.js'
import {
  flagDraft, roomViewMode, FLAG_COLOR_MAP, pendingTile, setPendingTile, clearPendingTile,
  modeHint, overlayAction, setOverlayAction, clearOverlayAction, buildDraft, confirmBuild,
  resetRoomViewMode, resetRoomViewModeOnNavigate,
} from '~/stores/roomViewStore'
import { setSelection, selection, updateSelectionWithDiff, updateSelectionFromObjects, createSelectedObject } from '~/stores/selectionStore.js'
import {
  decorationDraft, decorationPreviewItem, draftBounds, draftCapabilities, draftHasFrame,
  draftPlacement, setDraftPlacement,
} from '~/stores/decorationEditStore.js'
import { useRoomDecorationItems } from '~/components/roomView/useRoomDecorationItems.js'
import { PlacementFrame } from '~/components/inventory/PlacementFrame.js'
import { addToast } from '~/stores/toastStore.js'
import { parseRoomName, formatRoomName, isRoomInWorld } from '~/utils/roomName.js'
import { useRoomNavigationKeys } from '~/utils/useRoomNavigationKeys.js'
import { useRoomSubscription, type RoomState } from '~/components/roomView/useRoomSubscription.js'
import { useRoomHistory } from '~/components/roomView/useRoomHistory.js'
import { useRoomTerrain } from '~/components/roomView/useRoomTerrain.js'
import { regenerateUniqueFlagName } from '~/components/roomView/flagActions.js'
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
 * "Official room renderer" setting). RoomVisuals and decorations follow in later
 * migration phases (docs/project/renderer-migration.md).
 */
export function GameRoomViewer(props: GameRoomViewerProps) {
  let containerRef: HTMLDivElement | undefined
  const [gameRoom, setGameRoom] = createSignal<GameRoom | null>(null)
  const [objectState, setObjectState] = createSignal<RoomState | null>(null)
  const [visualState, setVisualState] = createSignal('')

  const terrain = useRoomTerrain({
    room: () => props.room,
    shard: () => props.shard,
  })

  useRoomSubscription({
    room: () => props.room,
    shard: () => props.shard,
    active: () => !historyMode(),
    onReset: () => {
      setObjectState(null)
      setVisualState('')
    },
    onState: (state, visual) => {
      setObjectState(state)
      setVisualState(visual)
    },
  })

  const { historyNoData } = useRoomHistory({
    room: () => props.room,
    shard: () => props.shard,
    active: historyMode,
    onEnter: () => setVisualState(''),
    onState: setObjectState,
  })

  const decorationItems = useRoomDecorationItems({
    room: () => props.room,
    shard: () => props.shard,
    enabled: showRoomDecorations,
  })
  // The draft changes on every pointer move, but its geometry is pinned, so comparing by
  // content keeps color/animation edits live without rebuilding on the drag path.
  const decorationPreview = createMemo(decorationPreviewItem, undefined, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  })
  const rendererDecorations = createMemo(() => {
    const raw = decorationItems()
    if (!raw || raw.room !== props.room) return []
    const preview = decorationPreview()
    const items = preview ? mergeDecorationItems(raw.items, [preview]) : raw.items
    return toRendererDecorations(items, decorationTextureUrl)
  })

  // GameRoom lifecycle: one instance per room (the engine leaks terrain/decoration/
  // effect state across rooms otherwise -- see GameRoom's doc comment), and the
  // dark-overlay toggle also rebuilds (lighting is baked into layer setup at world
  // init). Construction is serialized against the previous instance's release inside
  // GameRoom.create.
  createEffect(() => {
    void props.room
    void props.shard
    const darkOverlay = roomDarkOverlay()
    const container = containerRef
    if (!container) return

    let cancelled = false
    let created: GameRoom | null = null
    const settings = untrack(() => ({
      showCreepLabels: showCreepLabels(),
      terrainEffects: terrainEffects(),
      roomDarkOverlay: darkOverlay,
      smoothAnimations: smoothAnimations(),
    }))
    GameRoom.create({
      container,
      gameData: toGameData(settings, untrack(userInfo)?._id ?? ''),
      lighting: toLighting(settings),
      resourceMap,
    })
      .then((room) => {
        if (cancelled) {
          room.release()
          return
        }
        created = room
        setGameRoom(room)
      })
      .catch((err) => error('official renderer init failed:', err))

    onCleanup(() => {
      cancelled = true
      created?.release()
      setGameRoom(null)
    })
  })

  // Room switch bookkeeping. The renderer itself is recreated per room by the lifecycle
  // effect above; this only resets interaction modes.
  createEffect(() => {
    void props.room
    void props.shard

    resetRoomViewModeOnNavigate()

    // Keep the overlay alive for cross-room flag moves; update targetRoom to the new room
    const activeOverlay = untrack(overlayAction)
    if (activeOverlay?.type === 'moveFlag') {
      setOverlayAction({ ...activeOverlay, targetRoom: props.room })
    }
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

    if (state.diff) {
      updateSelectionWithDiff(state.diff, state.objects)
    } else {
      updateSelectionFromObjects(state.objects)
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

  // Update the RoomVisuals overlay each tick. Read visualState() before the optional
  // chain so SolidJS always tracks it, even while gameRoom is still initializing.
  createEffect(() => {
    const raw = visualState()
    const show = showRoomVisuals()
    gameRoom()?.visuals.update(show ? raw : '')
  })

  // Native decorations: graffiti + landscape recolors, applied whenever the items (or a
  // color/animation edit via the pinned preview) change.
  createEffect(() => {
    const g = gameRoom()
    if (!g) return
    g.applyDecorations(rendererDecorations())
  })

  // Dragging pushes the placement straight into a native rebuild, rAF-throttled --
  // Sprite.from hits the texture cache, so rebuilding a handful of sprites per frame is
  // cheap. Terrain recolor is skipped here (geometry doesn't affect it).
  let dragRaf: number | null = null
  createEffect(() => {
    const g = gameRoom()
    const draft = decorationDraft()
    const placement = draftPlacement()
    if (!g || !draft || !placement) return
    const items = rendererDecorations().map((item) =>
      item._id === draft.id ? { ...item, ...placement } : item)
    if (dragRaf !== null) cancelAnimationFrame(dragRaf)
    dragRaf = requestAnimationFrame(() => {
      dragRaf = null
      g.applyDecorations(items, { refreshTerrain: false })
    })
  })
  onCleanup(() => {
    if (dragRaf !== null) cancelAnimationFrame(dragRaf)
  })

  // Labels and swamp texture are baked into built sprites/terrain, so a change mutates
  // the world's live gameData and rebuilds the scene from current state. The baseline
  // guard skips the rebuild for a freshly created GameRoom (it was constructed with the
  // current settings, and an erase here would race the first applyState).
  let renderSettingsBaseline: { g: GameRoom; key: string } | null = null
  createEffect(() => {
    const g = gameRoom()
    if (!g) return
    const key = `${showCreepLabels()}|${terrainEffects()}`
    if (renderSettingsBaseline?.g !== g) {
      renderSettingsBaseline = { g, key }
      return
    }
    if (renderSettingsBaseline.key === key) return
    renderSettingsBaseline = { g, key }

    untrack(() => {
      g.updateGameData(toGameData({
        showCreepLabels: showCreepLabels(),
        terrainEffects: terrainEffects(),
        roomDarkOverlay: roomDarkOverlay(),
        smoothAnimations: smoothAnimations(),
      }, userInfo()?._id ?? ''))
      g.eraseObjects()
      const t = terrain()
      if (t && t.room === props.room) g.applyTerrain(t.room, t.data)
      const state = objectState()
      if (state) {
        const users = withBadgeUrls(state.users, badgeUrlTemplate())
        g.applyState(state.objects, users, gameTime() ?? undefined, 0)
      }
    })
  })

  // ── Tile interaction ────────────────────────────────────────────────────────────
  // Registered once per GameRoom; the handlers must read live props/stores at
  // invocation time, so the solid/reactivity check is intentionally suppressed.
  createEffect(() => {
    const g = gameRoom()
    if (!g) return
    g.camera.setTileHandlers(
      (tx, ty) => g.hover.setHoveredTile(tx, ty),
      (tx, ty, ctrlKey) => handleTileClick(g, tx, ty, ctrlKey),
      () => {
        const mode = roomViewMode()
        if (mode === 'build' || mode === 'flag' || mode === 'decorate' || overlayAction()?.type === 'moveFlag') {
          resetRoomViewMode()
          g.hover.clearPendingTile()
        }
      },
    )
  })

  function handleTileClick(g: GameRoom, tx: number, ty: number, ctrlKey: boolean): void {
    const currentRoom = props.room
    const currentShard = props.shard
    const mode = roomViewMode()

    // Decorate mode owns the canvas: the frame handles the gesture, and a click
    // beside it must not start changing the selection behind the editor.
    if (mode === 'decorate') return

    const overlay = overlayAction()

    if (overlay?.type === 'moveFlag') {
      const c = client()
      if (!c) return

      const { name, room: flagRoom, color, secondaryColor, targetRoom } = overlay
      c.http.game.removeFlag(flagRoom, name, currentShard ?? undefined)
        .then(() => c.http.game.createFlag(
          targetRoom, tx, ty, name, color, secondaryColor, currentShard ?? undefined,
        ))
        .then(() => {
          addToast(`Flag "${name}" moved`, 'success')
          clearOverlayAction()
        })
        .catch((err) => {
          error('move flag failed:', err)
          addToast(`Failed to move flag "${name}"`, 'error')
          clearOverlayAction()
        })
      return
    }

    if (mode === 'flag') {
      const pending = pendingTile()
      if (!pending || pending.tx !== tx || pending.ty !== ty) {
        setPendingTile({ tx, ty })
        g.hover.setPendingTile(tx, ty)
        return
      }

      const c = client()
      if (!c) return

      const draft = flagDraft()
      const name = draft.name.trim()
      if (!name) {
        addToast('Flag name is required', 'error')
        return
      }

      const color = FLAG_COLOR_MAP[draft.color] ?? 0
      const secondaryColor = FLAG_COLOR_MAP[draft.secondaryColor] ?? 0
      c.http.game.createFlag(currentRoom, tx, ty, name, color, secondaryColor, currentShard ?? undefined)
        .then(() => {
          addToast(`Flag "${name}" created`, 'success')
          clearPendingTile()
          g.hover.clearPendingTile()
          regenerateUniqueFlagName(c, name, currentShard)
        })
        .catch((err) => error('create flag failed:', err))
      return
    }

    if (mode === 'build') {
      if (!ctrlKey && !buildDraft().structureType) {
        addToast('Select a structure type first', 'error')
        return
      }

      if (ctrlKey) {
        const hits = objectsAtTile(objectState()?.objects ?? {}, tx, ty)
        const sites = hits.filter((obj) => obj.type === 'constructionSite')
        if (sites.length === 0) {
          addToast('No construction sites on this tile', 'error')
          return
        }
        const c = client()
        if (!c) return
        c.http.game.removeConstructionSite(currentRoom, sites.map((obj) => obj._id), currentShard ?? undefined)
          .then(() => {
            addToast(`Removed ${sites.length} construction site${sites.length > 1 ? 's' : ''}`, 'success')
            clearPendingTile()
            g.hover.clearPendingTile()
          })
          .catch((err) => {
            error('remove construction sites failed:', err)
            addToast(`Failed to remove construction sites: ${err.message}`, 'error')
          })
        return
      }

      setPendingTile({ tx, ty })
      g.hover.setPendingTile(tx, ty)
      confirmBuild(currentRoom, currentShard)
      return
    }

    // view mode: clear any pending marker
    clearPendingTile()
    g.hover.clearPendingTile()

    const hits = objectsAtTile(objectState()?.objects ?? {}, tx, ty)

    if (hits.length === 0) {
      if (!ctrlKey) setSelection([])
      return
    }

    let nextSelection = [...selection()]

    if (ctrlKey) {
      // Ctrl+Click: if ANY object on the tile is already selected → deselect
      // those objects only; otherwise add all objects on the tile.
      const hitIds = new Set(hits.map((obj) => obj._id))
      const hasSelected = nextSelection.some((s) => hitIds.has(s.id))

      if (hasSelected) {
        nextSelection = nextSelection.filter((s) => !hitIds.has(s.id))
      } else {
        const toAdd = hits
          .filter((obj) => !nextSelection.some((s) => s.id === obj._id))
          .map((obj) => createSelectedObject(obj._id, obj))
        nextSelection = [...nextSelection, ...toAdd]
      }
    } else {
      // Normal click: replace selection with objects on this tile
      nextSelection = hits.map((obj) => createSelectedObject(obj._id, obj))
    }

    setSelection(nextSelection)
  }

  // Selection overlays derive from the store, so clicks, per-tick diffs (dead creeps)
  // and sidebar-driven changes all keep the rings in sync. Creep rings track the
  // interpolating containers on the ticker.
  createEffect(() => {
    const g = gameRoom()
    const sel = selection()
    if (!g) return
    const visuals = sel
      .map(({ id, type }) => ({ id, type, visual: g.getObjectContainer(id) }))
      .filter((v): v is { id: string; type: string; visual: NonNullable<ReturnType<GameRoom['getObjectContainer']>> } =>
        v.visual != null && !v.visual.destroyed)
    g.hover.setSelectedObjects(visuals)
  })

  // Clear pending marker when switching back to view mode
  createEffect(() => {
    const mode = roomViewMode()
    const g = gameRoom()
    if (mode === 'view' && g) {
      clearPendingTile()
      g.hover.clearPendingTile()
    }
  })

  // Sync pending tile changes to the overlay (e.g., when cleared from Sidebar)
  createEffect(() => {
    const g = gameRoom()
    const pending = pendingTile()
    if (!g) return
    if (pending) {
      g.hover.setPendingTile(pending.tx, pending.ty)
    } else {
      g.hover.clearPendingTile()
    }
  })

  // ── In-room decoration editing ──────────────────────────────────────────────────
  // The frame and its handles are HTML drawn over the canvas, so they need the world
  // transform to be readable and to hold still. Locking the camera gives both.
  // The decoration artwork itself renders natively from Phase 6 onwards.
  const [viewTransform, setViewTransform] = createSignal({ x: 0, y: 0, scale: 1 })
  const decorating = createMemo(() => roomViewMode() === 'decorate')

  createEffect(() => {
    const g = gameRoom()
    if (!g) return

    const editing = decorating()
    g.camera.setCameraLocked(editing)
    if (!editing) {
      g.camera.setViewChangeHandler(null)
      return
    }

    const sync = () => setViewTransform(g.camera.viewTransform)
    g.camera.setViewChangeHandler(sync)
    sync()
    onCleanup(() => g.camera.setViewChangeHandler(null))
  })

  const hint = () => roomViewMode() === 'decorate' ? <DecorateHint /> : modeHint()

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={(el) => containerRef = el} style={{ width: '100%', height: '100%' }} />
      <Show when={roomViewMode() === 'decorate' && draftHasFrame() ? draftPlacement() : null}>
        {(placement) => (
          <div style={{ position: 'absolute', inset: '0', 'pointer-events': 'none', 'z-index': 9 }}>
            <PlacementFrame
              placement={placement()}
              capabilities={draftCapabilities()!}
              bounds={draftBounds()!}
              cellSize={CELL_SIZE * viewTransform().scale}
              originX={viewTransform().x}
              originY={viewTransform().y}
              previewUrl={decorationDraft()?.decoration.preview?.['256x256'] ?? decorationDraft()?.decoration.preview?.original}
              previewOpacity={0.3}
              onChange={setDraftPlacement}
            />
          </div>
        )}
      </Show>
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
