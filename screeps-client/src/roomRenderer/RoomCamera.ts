import type { GameRenderer } from '@screeps/renderer'
import { pixi7 } from './pixi7.js'
import { CELL_SIZE, ROOM_SIZE, VIEW_BOX } from './worldConfigs.js'

// Screen-pixel paddings, unchanged from the legacy camera (src/renderer/RoomRenderer.ts).
const PADDING = 48
const OVERSCROLL = 128
// World-unit values scale by CELL_SIZE / legacy TILE_SIZE (100 / 12).
const FIT_PADDING = 533
const NAV_PAD = 400
const MAX_SCALE = 0.6
const CLICK_THRESHOLD = 4
const ZOOM_RESISTANCE = 0.6

// The renderer's own layers occupy stage zIndex 0..6 under sortableChildren, so overlays
// have to sort past them.
export const OVERLAY_Z = {
  visuals: 100,
  hover: 110,
  nav: 120,
} as const

/**
 * Camera and tile-interaction port of the legacy RoomRenderer onto @screeps/renderer's stage.
 * The stage pivot is -CELL_SIZE/2, so stage.position is the screen position of the room's
 * top-left corner -- the same viewTransform contract the legacy camera exposed.
 */
export class RoomCamera {
  private readonly gameApp: GameRenderer
  private readonly container: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly navOverlay: import('pixi7').Container
  private readonly abort = new AbortController()
  private canDrag = false
  private cameraLocked = false
  private bounceRaf: number | null = null
  private wheelTimeout: number | null = null
  private lastMouseX = 0
  private lastMouseY = 0

  private onHoverTile: ((tx: number | null, ty: number | null) => void) | null = null
  private onClickTile: ((tx: number, ty: number, ctrlKey: boolean) => void) | null = null
  private onRightClick: (() => void) | null = null
  private onViewChange: (() => void) | null = null

  constructor(gameApp: GameRenderer, container: HTMLElement) {
    this.gameApp = gameApp
    this.container = container
    this.canvas = gameApp.app.view as unknown as HTMLCanvasElement

    const PIXI = pixi7()
    this.navOverlay = new PIXI.Container()
    this.navOverlay.zIndex = OVERLAY_Z.nav
    this.stage.addChild(this.navOverlay)

    this.setupCamera()
    this.resetView()
  }

  private get stage() {
    return this.gameApp.app.stage
  }

  private get scale(): number {
    return this.gameApp.zoomLevel
  }

  private set scale(value: number) {
    this.gameApp.zoomLevel = value
  }

  setCameraLocked(locked: boolean): void {
    if (this.cameraLocked === locked) return
    this.cameraLocked = locked
    if (locked) this.resetView()
  }

  /** Where the room sits on screen right now: origin of cell (0,0)'s corner plus the zoom. */
  get viewTransform(): { x: number; y: number; scale: number } {
    return { x: this.stage.position.x, y: this.stage.position.y, scale: this.scale }
  }

  /** Called whenever {@link viewTransform} changed -- pan, zoom, resize, reset. */
  setViewChangeHandler(handler: (() => void) | null): void {
    this.onViewChange = handler
  }

  setTileHandlers(
    onHover: (tx: number | null, ty: number | null) => void,
    onClick: (tx: number, ty: number, ctrlKey: boolean) => void,
    onRightClick?: () => void,
  ): void {
    this.onHoverTile = onHover
    this.onClickTile = onClick
    this.onRightClick = onRightClick ?? null
  }

  /** Convert screen (canvas-relative) coordinates to tile [0..49] coords; null outside the room. */
  screenToTile(screenX: number, screenY: number): { tx: number; ty: number } | null {
    const scale = this.scale
    const tx = Math.floor((screenX - this.stage.position.x) / scale / CELL_SIZE)
    const ty = Math.floor((screenY - this.stage.position.y) / scale / CELL_SIZE)
    if (tx < 0 || tx >= ROOM_SIZE || ty < 0 || ty >= ROOM_SIZE) return null
    return { tx, ty }
  }

  resetView(): void {
    this.cancelBounce()
    this.cancelWheelTimeout()
    this.scale = this.getMinScale()
    this.centerView()
    this.clampView()
  }

  /** Called by GameRoom's ResizeObserver after the renderer itself was resized. */
  handleResize(): void {
    // A locked camera re-fits instead of clamping, so "the whole room is visible"
    // survives the sidebar being opened or the window being resized.
    if (this.cameraLocked) this.resetView()
    else this.clampView()
  }

  destroy(): void {
    this.abort.abort()
    this.cancelBounce()
    this.cancelWheelTimeout()
    this.navOverlay.parent?.removeChild(this.navOverlay)
    this.navOverlay.destroy({ children: true })
  }

  private getMinScale(): number {
    const cw = this.container.clientWidth
    const ch = this.container.clientHeight
    return Math.min(cw, ch) / (VIEW_BOX + FIT_PADDING)
  }

  private centerView(): void {
    const cx = this.container.clientWidth / 2
    const cy = this.container.clientHeight / 2
    const scale = this.scale
    this.stage.position.x = cx - (VIEW_BOX * scale) / 2
    this.stage.position.y = cy - (VIEW_BOX * scale) / 2
  }

  private clampView(extended = false): void {
    const scale = this.scale
    const scaledSize = VIEW_BOX * scale
    const cw = this.container.clientWidth
    const ch = this.container.clientHeight
    const extra = extended ? OVERSCROLL : 0
    const pos = this.stage.position

    if (scaledSize <= cw) {
      const centerX = cw / 2 - scaledSize / 2
      if (extended) {
        pos.x = Math.min(centerX + OVERSCROLL, Math.max(centerX - OVERSCROLL, pos.x))
      } else {
        pos.x = centerX
      }
    } else {
      const minX = cw - scaledSize - PADDING - extra
      const maxX = PADDING + extra
      pos.x = Math.min(maxX, Math.max(minX, pos.x))
    }

    if (scaledSize <= ch) {
      const centerY = ch / 2 - scaledSize / 2
      if (extended) {
        pos.y = Math.min(centerY + OVERSCROLL, Math.max(centerY - OVERSCROLL, pos.y))
      } else {
        pos.y = centerY
      }
    } else {
      const minY = ch - scaledSize - PADDING - extra
      const maxY = PADDING + extra
      pos.y = Math.min(maxY, Math.max(minY, pos.y))
    }

    this.canDrag = true
    this.onViewChange?.()
  }

  private getTargetPosition(): { x: number; y: number } | null {
    const scaledSize = VIEW_BOX * this.scale
    const cw = this.container.clientWidth
    const ch = this.container.clientHeight
    const pos = this.stage.position

    let targetX: number | null = null
    let targetY: number | null = null

    if (scaledSize <= cw) {
      targetX = cw / 2 - scaledSize / 2
    } else {
      const minX = cw - scaledSize - PADDING
      const maxX = PADDING
      if (pos.x < minX) targetX = minX
      else if (pos.x > maxX) targetX = maxX
    }

    if (scaledSize <= ch) {
      targetY = ch / 2 - scaledSize / 2
    } else {
      const minY = ch - scaledSize - PADDING
      const maxY = PADDING
      if (pos.y < minY) targetY = minY
      else if (pos.y > maxY) targetY = maxY
    }

    if (targetX === null && targetY === null) return null
    return { x: targetX ?? pos.x, y: targetY ?? pos.y }
  }

  private getTargetScale(): number | null {
    const minScale = this.getMinScale()
    if (this.scale < minScale) return minScale
    if (this.scale > MAX_SCALE) return MAX_SCALE
    return null
  }

  private springBack(): void {
    const targetPos = this.getTargetPosition()
    const targetScale = this.getTargetScale()

    if (!targetPos && targetScale === null) return

    const pos = this.stage.position
    const startX = pos.x
    const startY = pos.y
    const startScale = this.scale
    const startTime = performance.now()
    const duration = 300

    // For scale bounce, always use viewport center to avoid drift
    const viewportCenterX = this.container.clientWidth / 2
    const viewportCenterY = this.container.clientHeight / 2
    const worldCenterX = (viewportCenterX - startX) / startScale
    const worldCenterY = (viewportCenterY - startY) / startScale

    const animate = (now: number) => {
      const elapsed = now - startTime
      const t = Math.min(1, elapsed / duration)
      const ease = 1 - Math.pow(1 - t, 3)

      if (targetScale !== null) {
        const currentScale = startScale + (targetScale - startScale) * ease
        this.scale = currentScale
        pos.x = viewportCenterX - worldCenterX * currentScale
        pos.y = viewportCenterY - worldCenterY * currentScale
      }

      if (targetPos && targetScale === null) {
        pos.x = startX + (targetPos.x - startX) * ease
        pos.y = startY + (targetPos.y - startY) * ease
      }

      if (t < 1) {
        this.bounceRaf = requestAnimationFrame(animate)
      } else {
        this.bounceRaf = null
        this.clampView()
      }
    }

    this.cancelBounce()
    this.bounceRaf = requestAnimationFrame(animate)
  }

  private cancelBounce(): void {
    if (this.bounceRaf !== null) {
      cancelAnimationFrame(this.bounceRaf)
      this.bounceRaf = null
    }
  }

  private cancelWheelTimeout(): void {
    if (this.wheelTimeout !== null) {
      clearTimeout(this.wheelTimeout)
      this.wheelTimeout = null
    }
  }

  private setupCamera(): void {
    const canvas = this.canvas
    const { signal } = this.abort
    let dragging = false
    let lastPos = { x: 0, y: 0 }
    let pointerDownPos = { x: 0, y: 0 }

    canvas.style.touchAction = 'none'
    canvas.style.userSelect = 'none'

    const activePointers = new Map<number, { x: number; y: number }>()
    let pinching = false
    let pinchPivotWorldX = 0
    let pinchPivotWorldY = 0
    let pinchStartDist = 0
    let pinchStartScale = 0

    canvas.addEventListener('pointerdown', (e) => {
      this.cancelBounce()
      this.cancelWheelTimeout()
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      canvas.setPointerCapture(e.pointerId)

      if (this.cameraLocked) {
        // Still track the pointer so a tap is recognised as a click, but never pan or
        // zoom: the decoration editor's HTML handles are positioned against this view.
        pinching = false
        dragging = false
        lastPos = { x: e.clientX, y: e.clientY }
        pointerDownPos = { x: e.clientX, y: e.clientY }
      } else if (activePointers.size >= 2) {
        // Enter pinch mode, cancel single-finger drag
        dragging = false
        pinching = true
        const pts = [...activePointers.values()]
        const rect = canvas.getBoundingClientRect()
        const midX = (pts[0].x + pts[1].x) / 2 - rect.left
        const midY = (pts[0].y + pts[1].y) / 2 - rect.top
        pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
        pinchStartScale = this.scale
        pinchPivotWorldX = (midX - this.stage.position.x) / pinchStartScale
        pinchPivotWorldY = (midY - this.stage.position.y) / pinchStartScale
      } else {
        pinching = false
        dragging = this.canDrag
        lastPos = { x: e.clientX, y: e.clientY }
        pointerDownPos = { x: e.clientX, y: e.clientY }
      }
    }, { signal })

    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect()
      this.lastMouseX = e.clientX - rect.left
      this.lastMouseY = e.clientY - rect.top

      if (activePointers.has(e.pointerId)) {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      }

      if (pinching && activePointers.size === 2) {
        const pts = [...activePointers.values()]
        const newMidX = (pts[0].x + pts[1].x) / 2 - rect.left
        const newMidY = (pts[0].y + pts[1].y) / 2 - rect.top
        const newDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
        const minScale = this.getMinScale()
        let newScale = pinchStartScale * (newDist / pinchStartDist)
        if (newScale < minScale) newScale = minScale + (newScale - minScale) * ZOOM_RESISTANCE
        if (newScale > MAX_SCALE) newScale = MAX_SCALE + (newScale - MAX_SCALE) * ZOOM_RESISTANCE
        this.cancelBounce()
        this.scale = newScale
        this.stage.position.x = newMidX - pinchPivotWorldX * newScale
        this.stage.position.y = newMidY - pinchPivotWorldY * newScale
        this.clampView(true)
        return
      }

      // Update hover when not pinching
      if (!pinching) {
        const tile = this.screenToTile(this.lastMouseX, this.lastMouseY)
        this.onHoverTile?.(tile?.tx ?? null, tile?.ty ?? null)
      }

      if (!dragging || !this.canDrag) return
      this.stage.position.x += e.clientX - lastPos.x
      this.stage.position.y += e.clientY - lastPos.y
      lastPos = { x: e.clientX, y: e.clientY }
      this.clampView(true)
    }, { signal })

    const onUp = (e: PointerEvent) => {
      canvas.releasePointerCapture(e.pointerId)
      activePointers.delete(e.pointerId)

      if (pinching) {
        if (activePointers.size < 2) {
          pinching = false
          dragging = false
          this.springBack()
        }
        return
      }

      dragging = false

      // Treat as click if the pointer barely moved
      const dx = e.clientX - pointerDownPos.x
      const dy = e.clientY - pointerDownPos.y
      if (Math.sqrt(dx * dx + dy * dy) < CLICK_THRESHOLD) {
        const rect = canvas.getBoundingClientRect()
        const tile = this.screenToTile(e.clientX - rect.left, e.clientY - rect.top)
        if (tile) this.onClickTile?.(tile.tx, tile.ty, e.ctrlKey || e.metaKey)
      }

      if (!this.cameraLocked) this.springBack()
    }
    canvas.addEventListener('pointerup', onUp, { signal })
    canvas.addEventListener('pointercancel', onUp, { signal })

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      // button === 0 means Ctrl+Click on macOS — treat that as a regular click, not right-click
      if (e.button === 2) this.onRightClick?.()
    }, { signal })

    canvas.addEventListener('pointerleave', () => {
      this.onHoverTile?.(null, null)
    }, { signal })

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      if (this.cameraLocked) return
      const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1
      const minScale = this.getMinScale()
      let newScale = this.scale * scaleFactor

      // Rubber-band resistance: the further past the limit, the less effect
      if (newScale < minScale) {
        newScale = minScale + (newScale - minScale) * ZOOM_RESISTANCE
      }
      if (newScale > MAX_SCALE) {
        newScale = MAX_SCALE + (newScale - MAX_SCALE) * ZOOM_RESISTANCE
      }

      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      this.cancelBounce()

      const pos = this.stage.position
      if (newScale < minScale) {
        // Overzoom: zoom around viewport center so the room shrinks in place
        const viewportCenterX = this.container.clientWidth / 2
        const viewportCenterY = this.container.clientHeight / 2
        const worldCenterX = (viewportCenterX - pos.x) / this.scale
        const worldCenterY = (viewportCenterY - pos.y) / this.scale
        this.scale = newScale
        pos.x = viewportCenterX - worldCenterX * newScale
        pos.y = viewportCenterY - worldCenterY * newScale
      } else {
        // Normal zoom: zoom around mouse pointer
        const worldX = (mouseX - pos.x) / this.scale
        const worldY = (mouseY - pos.y) / this.scale
        this.scale = newScale
        pos.x = mouseX - worldX * newScale
        pos.y = mouseY - worldY * newScale
      }

      this.clampView()

      // Debounced spring back after zoom settles
      this.cancelWheelTimeout()
      this.wheelTimeout = window.setTimeout(() => {
        this.wheelTimeout = null
        this.springBack()
      }, 80)
    }, { passive: false, signal })
  }

  setupNavigationZones(handlers: {
    west?: () => void
    east?: () => void
    north?: () => void
    south?: () => void
  }): void {
    const PIXI = pixi7()
    this.navOverlay.removeChildren()

    // The nav overlay lives on the renderer's stage, whose pivot is -CELL_SIZE/2; zone
    // coordinates are relative to the room's top-left corner, so offset by the pivot.
    const ORIGIN = -CELL_SIZE / 2

    const createZone = (
      x: number,
      y: number,
      w: number,
      h: number,
      arrow: number[],
      handler?: () => void,
    ): void => {
      if (!handler) return

      const zone = new PIXI.Graphics()
      zone.x = ORIGIN + x
      zone.y = ORIGIN + y
      // Invisible hit area so the whole zone is interactive
      zone.hitArea = new PIXI.Rectangle(0, 0, w, h)
      zone.beginFill(0xffffff, 0.12)
      zone.drawPolygon(arrow)
      zone.endFill()

      zone.eventMode = 'static'
      zone.cursor = 'pointer'

      zone.on('pointerover', () => {
        zone.clear()
        zone.beginFill(0xffffff, 0.06)
        zone.drawRect(0, 0, w, h)
        zone.endFill()
        zone.beginFill(0xffffff, 0.35)
        zone.drawPolygon(arrow)
        zone.endFill()
      })

      zone.on('pointerout', () => {
        zone.clear()
        zone.beginFill(0xffffff, 0.12)
        zone.drawPolygon(arrow)
        zone.endFill()
      })

      zone.on('pointerdown', handler)

      this.navOverlay.addChild(zone)
    }

    // Legacy geometry scaled by CELL_SIZE / TILE_SIZE (100 / 12).
    const cx = VIEW_BOX / 2
    const cy = VIEW_BOX / 2
    const ah = 150 // half-height of arrow base
    const tip = 150 // arrow tip inset from the room edge
    const base = 50 // arrow base inset from the outer edge

    createZone(-NAV_PAD, 0, NAV_PAD, VIEW_BOX, [
      tip, cy,
      NAV_PAD - base, cy - ah,
      NAV_PAD - base, cy + ah,
    ], handlers.west)

    createZone(VIEW_BOX, 0, NAV_PAD, VIEW_BOX, [
      NAV_PAD - tip, cy,
      base, cy - ah,
      base, cy + ah,
    ], handlers.east)

    createZone(0, -NAV_PAD, VIEW_BOX, NAV_PAD, [
      cx, tip,
      cx - ah, NAV_PAD - base,
      cx + ah, NAV_PAD - base,
    ], handlers.north)

    createZone(0, VIEW_BOX, VIEW_BOX, NAV_PAD, [
      cx, NAV_PAD - tip,
      cx - ah, base,
      cx + ah, base,
    ], handlers.south)

    // Trigger pointerover for zones already under the mouse
    for (const child of this.navOverlay.children) {
      const zone = child as import('pixi7').Graphics
      const hitArea = zone.hitArea as import('pixi7').Rectangle
      const scale = this.scale
      // Child screen position accounts for the stage pivot: sx = pos + (zone.x - pivot) * scale.
      const sx = this.stage.position.x + (zone.x + CELL_SIZE / 2) * scale
      const sy = this.stage.position.y + (zone.y + CELL_SIZE / 2) * scale
      const sw = hitArea.width * scale
      const sh = hitArea.height * scale
      if (
        this.lastMouseX >= sx &&
        this.lastMouseX <= sx + sw &&
        this.lastMouseY >= sy &&
        this.lastMouseY <= sy + sh
      ) {
        ;(zone as unknown as { emit(event: string): void }).emit('pointerover')
      }
    }
  }
}
