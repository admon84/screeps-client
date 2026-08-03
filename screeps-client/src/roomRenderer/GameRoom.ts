import type { DecorationItem, GameData, GameRenderer, StateUser, TerrainState, WorldConfigs } from '@screeps/renderer'
import type { RoomObjectMap, RoomTerrain } from 'screeps-connectivity'
import { loadRenderer } from './loadRenderer.js'
import { pixi7 } from './pixi7.js'
import { buildWorldConfigs } from './worldConfigs.js'
import { RoomCamera } from './RoomCamera.js'
import { HoverOverlay } from './overlays/HoverOverlay.js'
import { VisualOverlay } from './overlays/VisualOverlay.js'
import { toRendererState } from './adapters/stateAdapter.js'
import { toRendererTerrain } from './adapters/terrainAdapter.js'

// release() tears down PIXI's GLOBAL texture registries (Assets.reset, destroyTextureCache),
// so two overlapping renderers destroy each other's textures. This chain serializes every
// construction behind the previous instance's build AND teardown.
let rendererHandoff: Promise<void> = Promise.resolve()

// wallObjects mixes RenderTextures with the sprites that display them, so only entries that
// actually carry `visible` are touched.
type TerrainObjects = {
  wallObjects?: Array<{ visible?: boolean }>
  swampObjects?: Array<{ visible?: boolean }>
  previousWallsMd5?: string | null
  previousSwampsMd5?: string | null
}

export interface GameRoomOptions {
  container: HTMLElement
  gameData: GameData
  lighting: WorldConfigs['lighting']
  resourceMap: Record<string, string>
  onGameLoop?: () => void
}

/**
 * Lifecycle wrapper around @screeps/renderer's GameRenderer: serialized construction,
 * retina setup, resize observation, terrain/state application, and release.
 */
export class GameRoom {
  readonly gameApp: GameRenderer
  readonly camera: RoomCamera
  readonly hover: HoverOverlay
  readonly visuals: VisualOverlay
  private readonly gameData: GameData
  private readonly resizeObserver: ResizeObserver
  private readonly releaseDone: () => void
  private released = false
  private lastTerrain: TerrainState[] | null = null
  private lastDecorations: DecorationItem[] = []

  static async create(options: GameRoomOptions): Promise<GameRoom> {
    const previous = rendererHandoff
    let releaseDone!: () => void
    const released = new Promise<void>((resolve) => { releaseDone = resolve })

    const creation = (async () => {
      await previous
      const { GameRenderer, metadata } = await loadRenderer()

      const worldConfigs = buildWorldConfigs({
        metadata,
        gameData: options.gameData,
        lighting: options.lighting,
      })
      GameRenderer.compileMetadata(worldConfigs.metadata)

      // The renderer builds its PIXI Application without passing `resolution`; the device
      // pixel ratio only reaches it through the global default, read in the constructor.
      pixi7().settings.RESOLUTION = window.devicePixelRatio || 1

      const gameApp = new GameRenderer({
        size: {
          width: options.container.clientWidth,
          height: options.container.clientHeight,
        },
        resourceMap: options.resourceMap,
        worldConfigs,
        backgroundColor: 0x0d1117,
        countMetrics: import.meta.env.DEV,
        onGameLoop: options.onGameLoop,
      })
      await gameApp.init(options.container)

      // autoDensity is a read-only getter over the view system in PIXI 7, so the flag has
      // to be set on `_view` itself; resize() then writes the corrected CSS size back.
      ;(gameApp.app.renderer as unknown as { _view: { autoDensity: boolean } })._view.autoDensity = true
      gameApp.app.renderer.resize(options.container.clientWidth, options.container.clientHeight)

      return new GameRoom(gameApp, options.container, options.gameData, releaseDone)
    })()

    // The next instance waits for this build and, if it succeeded, for its release.
    rendererHandoff = creation.then(() => released, () => undefined)
    return creation
  }

  private constructor(gameApp: GameRenderer, container: HTMLElement, gameData: GameData, releaseDone: () => void) {
    this.gameApp = gameApp
    this.gameData = gameData
    this.releaseDone = releaseDone
    this.camera = new RoomCamera(gameApp, container)
    this.hover = new HoverOverlay(gameApp)
    this.visuals = new VisualOverlay(gameApp)

    this.resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      this.gameApp.resize({ width, height })
      this.camera.handleResize()
    })
    this.resizeObserver.observe(container)

    if (import.meta.env.DEV) {
      ;(globalThis as Record<string, unknown>).__PIXI7_APP__ = gameApp.app
    }
  }

  applyTerrain(room: string, terrain: RoomTerrain): void {
    const sparse = toRendererTerrain(room, terrain)
    this.lastTerrain = sparse
    this.gameApp.setTerrain(sparse)
    // An empty set leaves the previous walls and swamps drawn -- the terrain processor has
    // no "clear" path for them -- so they have to be hidden here.
    if (sparse.length === 0) this.clearTerrainSprites()
    // Graffiti masks against stage.terrainObjects.wallMask, which setTerrain just rebuilt.
    if (this.lastDecorations.length) this.gameApp.setDecorations(this.lastDecorations)
  }

  /**
   * Native decoration pipeline (wall graffiti + landscapes). The terrain processor reads
   * world.decorations for landscape/road recolors and invalidates its md5 cache when the
   * decoration identity changes, so terrain is re-applied afterwards -- except on the
   * editor's drag path, where only geometry changed and a full terrain SVG rebuild per
   * frame would kill pointer responsiveness.
   */
  applyDecorations(items: DecorationItem[], { refreshTerrain = true } = {}): void {
    if (items.length === 0 && this.lastDecorations.length === 0) return
    this.lastDecorations = items
    this.gameApp.setDecorations(items)
    if (refreshTerrain && this.lastTerrain) this.gameApp.setTerrain(this.lastTerrain)
  }

  applyState(
    objects: RoomObjectMap,
    users: Record<string, StateUser>,
    gameTime: number | undefined,
    tickSeconds: number,
  ): void {
    this.gameApp.applyState(toRendererState(objects, users, gameTime), tickSeconds)
  }

  eraseObjects(): void {
    this.gameApp.erase()
  }

  /**
   * Mutates the live gameData object the World holds a reference to (re-read on every
   * applyState and setTerrain). Existing sprites keep their labels/textures, so the
   * caller follows up with eraseObjects() + a full re-apply (+ re-terrain for
   * swampTexture changes).
   */
  updateGameData(next: GameData): void {
    Object.assign(this.gameData, next)
  }

  getObjectContainer(id: string): import('pixi7').Container | null {
    return this.gameApp.world.gameObjects[id]?.rootContainer ?? null
  }

  release(): void {
    if (this.released) return
    this.released = true
    this.resizeObserver.disconnect()
    this.visuals.destroy()
    this.hover.destroy()
    this.camera.destroy()
    this.gameApp.release()
    if (import.meta.env.DEV) {
      delete (globalThis as Record<string, unknown>).__PIXI7_APP__
    }
    this.releaseDone()
  }

  private clearTerrainSprites(): void {
    const terrainObjects = (this.gameApp.app.stage as unknown as { terrainObjects?: TerrainObjects }).terrainObjects
    if (!terrainObjects) return

    const hide = (entries?: Array<{ visible?: boolean }>) =>
      entries?.forEach((entry) => {
        if (entry && 'visible' in entry) entry.visible = false
      })

    hide(terrainObjects.wallObjects)
    hide(terrainObjects.swampObjects)
    // Clearing the md5 cache forces a real rebuild on the next non-empty terrain.
    terrainObjects.previousWallsMd5 = null
    terrainObjects.previousSwampsMd5 = null
  }
}
