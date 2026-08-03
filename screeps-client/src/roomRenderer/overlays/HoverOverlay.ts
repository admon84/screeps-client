import type { GameRenderer } from '@screeps/renderer'
import { pixi7 } from '../pixi7.js'
import { CELL_SIZE } from '../worldConfigs.js'
import { OVERLAY_Z } from '../RoomCamera.js'

type Container7 = import('pixi7').Container
type Graphics7 = import('pixi7').Graphics

export interface SelectionVisual {
  id: string
  type: string
  /** The object's live rootContainer (world.gameObjects), positioned at the tile CENTER. */
  visual: Container7
}

const HALF = CELL_SIZE / 2
// Stroke widths and paddings are the legacy HoverHighlightLayer values scaled by
// CELL_SIZE / TILE_SIZE (100 / 12).
const THIN = 8
const THICK = 12
const PAD = 8

/**
 * PIXI 7 port of the legacy HoverHighlightLayer: hover tile highlight, pending-tile
 * crosshair, and selection overlays (rings for creeps, boxes for structures) drawn
 * above the renderer's own layers.
 */
export class HoverOverlay {
  readonly container: Container7

  private hoverGraphics: Graphics7
  private pendingGraphics: Graphics7
  private selectionContainer: Container7
  private selectionGraphics = new Map<string, Graphics7>()
  private selectionTypes = new Map<string, string>()
  private selectionVisuals = new Map<string, Container7>()

  private readonly gameApp: GameRenderer
  private readonly tickerCallback: () => void

  constructor(gameApp: GameRenderer) {
    this.gameApp = gameApp
    const PIXI = pixi7()

    this.container = new PIXI.Container()
    this.container.zIndex = OVERLAY_Z.hover
    this.container.eventMode = 'none'

    this.hoverGraphics = new PIXI.Graphics()
    this.container.addChild(this.hoverGraphics)
    this.pendingGraphics = new PIXI.Graphics()
    this.container.addChild(this.pendingGraphics)
    this.selectionContainer = new PIXI.Container()
    this.container.addChild(this.selectionContainer)

    gameApp.app.stage.addChild(this.container)

    this.tickerCallback = () => this.trackCreepRings()
    gameApp.app.ticker.add(this.tickerCallback)
  }

  /** Update the hover highlight to the given tile, or clear if null. */
  setHoveredTile(tx: number | null, ty: number | null): void {
    this.hoverGraphics.clear()
    if (tx === null || ty === null) return

    const px = tx * CELL_SIZE - HALF
    const py = ty * CELL_SIZE - HALF
    this.hoverGraphics.lineStyle(THIN, 0xffffff, 0.35)
    this.hoverGraphics.drawRect(px, py, CELL_SIZE, CELL_SIZE)
    this.hoverGraphics.lineStyle(0)
    this.hoverGraphics.beginFill(0xffffff, 0.06)
    this.hoverGraphics.drawRect(px, py, CELL_SIZE, CELL_SIZE)
    this.hoverGraphics.endFill()
  }

  /** Replace the current selection overlays with overlays for the given objects. */
  setSelectedObjects(objects: SelectionVisual[]): void {
    this.clearSelection()

    const PIXI = pixi7()
    for (const { id, type, visual } of objects) {
      const g = new PIXI.Graphics()
      g.eventMode = 'none'
      this.selectionContainer.addChild(g)
      this.selectionGraphics.set(id, g)
      this.selectionTypes.set(id, type)
      this.selectionVisuals.set(id, visual)

      if (type === 'creep') {
        this.drawCreepRing(g, visual.x, visual.y)
      } else {
        this.drawStructureBox(g, visual.x, visual.y)
      }
    }
  }

  clearSelection(): void {
    this.selectionContainer.removeChildren()
    for (const g of this.selectionGraphics.values()) g.destroy()
    this.selectionGraphics.clear()
    this.selectionTypes.clear()
    this.selectionVisuals.clear()
  }

  /** Show a crosshair marker on the given tile, or clear if null. */
  setPendingTile(tx: number | null, ty: number | null): void {
    this.pendingGraphics.clear()
    if (tx === null || ty === null) return

    const cx = tx * CELL_SIZE
    const cy = ty * CELL_SIZE
    const r = CELL_SIZE * 0.35

    this.pendingGraphics.lineStyle(THICK, 0xf0883e, 0.9)
    this.pendingGraphics.moveTo(cx - r, cy)
    this.pendingGraphics.lineTo(cx + r, cy)
    this.pendingGraphics.moveTo(cx, cy - r)
    this.pendingGraphics.lineTo(cx, cy + r)

    this.pendingGraphics.lineStyle(THICK, 0xf0883e, 0.6)
    this.pendingGraphics.drawRect(cx - HALF + PAD, cy - HALF + PAD, CELL_SIZE - PAD * 2, CELL_SIZE - PAD * 2)
  }

  clearPendingTile(): void {
    this.pendingGraphics.clear()
  }

  private drawCreepRing(g: Graphics7, cx: number, cy: number): void {
    g.clear()
    g.lineStyle(THICK, 0xffffff, 0.9)
    g.drawCircle(cx, cy, CELL_SIZE * 0.48)
  }

  private drawStructureBox(g: Graphics7, cx: number, cy: number): void {
    g.clear()
    const size = CELL_SIZE - PAD * 2
    g.lineStyle(THICK, 0xffffff, 0.9)
    g.drawRect(cx - HALF + PAD, cy - HALF + PAD, size, size)
    g.lineStyle(0)
    g.beginFill(0xffffff, 0.04)
    g.drawRect(cx - HALF + PAD, cy - HALF + PAD, size, size)
    g.endFill()
  }

  /** Keeps creep rings locked to their interpolating containers each frame. */
  private trackCreepRings(): void {
    for (const [id, g] of this.selectionGraphics) {
      if (this.selectionTypes.get(id) !== 'creep') continue
      const visual = this.selectionVisuals.get(id)
      if (!visual || visual.destroyed) continue
      this.drawCreepRing(g, visual.x, visual.y)
    }
  }

  destroy(): void {
    this.gameApp.app.ticker.remove(this.tickerCallback)
    this.clearSelection()
    this.container.parent?.removeChild(this.container)
    this.container.destroy({ children: true })
  }
}
