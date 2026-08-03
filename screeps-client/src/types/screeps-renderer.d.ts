// Hand-written declarations for the untyped @screeps/renderer UMD bundle (v1.6.10), adapted from
// screeps-room-planner's reverse-engineered set. Only the surface this client consumes is declared.
// PIXI types come from the `pixi7` alias package (pixi.js@7, types only) because the renderer
// bundles its own PIXI 7 and publishes it as window.PIXI -- it is never imported at runtime.

declare module '@screeps/renderer' {
  type Pixi7Application = import('pixi7').Application
  type Pixi7Container = import('pixi7').Container

  export interface Size {
    width: number
    height: number
  }

  export interface GameData {
    player: string
    showMyNames: { spawns: boolean; creeps: boolean }
    showEnemyNames: { spawns: boolean; creeps: boolean }
    showFlagsNames: boolean
    showCreepSpeech: boolean
    swampTexture: string
  }

  export interface ProcessorMetadata {
    type: string
    id?: string
    payload?: { style?: { fontFamily?: string; [key: string]: unknown }; [key: string]: unknown }
    [key: string]: unknown
  }

  export interface ObjectMetadata {
    processors?: ProcessorMetadata[]
    [key: string]: unknown
  }

  export interface Metadata {
    preprocessors: string[]
    layers: Array<{ id: string; isDefault?: boolean; [key: string]: unknown }>
    objects: { [type: string]: ObjectMetadata }
    isCompiled?: boolean
  }

  export interface WorldConfigs {
    ATTACK_PENETRATION: number
    CELL_SIZE: number
    /** Undocumented but mandatory: pathHelper sizes its tile array from it; setTerrain throws without it. */
    ROOM_SIZE: number
    RENDER_SIZE: Size
    VIEW_BOX: number
    BADGE_URL: string
    /** Rampart fill without users[id].color: green for gameData.player, red for everyone else. */
    userOwnerColor?: boolean
    metadata: Metadata
    gameData: GameData
    lighting: 'normal' | 'low' | 'disabled'
    forceCanvas?: boolean
  }

  export interface ObjectState {
    type: string
    _id?: string
    room: string
    x: number
    y: number
    [key: string]: unknown
  }

  export interface StateUser {
    _id?: string
    username: string
    badge?: unknown
    /** Read by the userBadge processor; normally written by the setBadgeUrls preprocessor. */
    badgeUrl?: string
    color?: string
  }

  export interface State {
    objects: ObjectState[]
    users?: Record<string, StateUser>
    gameTime?: number
    info?: object
    flags?: unknown[]
    visual?: string
    /** Injected by World.applyState -- the renderer MUTATES the passed state. */
    gameData?: GameData
  }

  export interface TerrainState {
    room: string
    x: number
    y: number
    type: 'wall' | 'swamp'
  }

  export interface DecorationItem {
    _id: string
    user?: string
    decoration: { type: string; [key: string]: unknown }
    [key: string]: unknown
  }

  export interface Metrics {
    fps?: number
    gameObjectCounter: number
    rendererCounter: number
    devicePixelRatio: number
    stageSize?: Size
    renderer: { size: number; WebGL?: boolean; GPU?: string; [key: string]: unknown }
  }

  export class GameObject {
    rootContainer: Pixi7Container
  }

  export class ActionManager {
    actions: Record<string, { actionHandle: unknown; container: Pixi7Container }>
    cancelAction(handle: unknown): void
  }

  export class World {
    gameObjects: Record<string, GameObject>
    decorations: unknown[]
    decorationsContainer?: Pixi7Container
    applyState(state: State, tickDuration: number, globalOnly?: boolean): void
    removeAllObjects(): void
    release(): void
  }

  export interface GameRendererOptions {
    size?: Size
    worldConfigs: WorldConfigs
    resourceMap: Record<string, string>
    autoStart?: boolean
    backgroundColor?: number
    useDefaultLogger?: boolean
    logger?: object
    objectFilter?: (objects: ObjectState[]) => ObjectState[]
    countMetrics?: boolean
    onGameLoop?: () => void
  }

  export class GameRenderer {
    /** Synchronous; mutates the metadata in place and marks it isCompiled (idempotent). */
    static compileMetadata(metadata: Metadata): void
    static isWebGLSupported(): boolean

    app: Pixi7Application
    world: World
    actionManager: ActionManager
    metrics: Metrics
    released?: boolean

    constructor(options: GameRendererOptions)

    /** Creates its own canvas and appends it to the container. */
    init(container: HTMLElement): Promise<void>

    applyState(state: State, tickDuration: number): void
    setTerrain(terrain: TerrainState[]): void
    setDecorations(items: DecorationItem[]): void
    erase(): void

    get zoomLevel(): number
    set zoomLevel(value: number)
    pan(x: number, y: number): void
    zoomTo(value: number, x: number, y: number): void
    /** No-op without an argument. */
    resize(newSize?: Size): void

    start(): void
    release(): void
  }
}

declare module '@screeps/renderer-metadata' {
  global {
    /** Set as a side effect of importing this package; requires window.PIXI (import @screeps/renderer first). */
    const RENDERER_METADATA: import('@screeps/renderer').Metadata
  }
}
