import type { GameRenderer } from '@screeps/renderer'
import type { RoomVisualEntry, VisualStyle } from 'screeps-connectivity'
import { pixi7 } from '../pixi7.js'
import { CELL_SIZE, VIEW_BOX } from '../worldConfigs.js'
import { OVERLAY_Z } from '../RoomCamera.js'

// Canvas-space drawing units, inherited from the legacy VisualLayer: a tile is 12 canvas
// units and the room 600; drawScale maps them onto whatever physical size the canvas has.
const TILE = 12
const ROOM = 50 * TILE
const tp = (c: number) => (c + 0.5) * TILE

const DASH_PX: Record<string, [number, number]> = {
  dashed: [0.3 * TILE, 0.25 * TILE],
  dotted: [0.1 * TILE, 0.2 * TILE],
}

// Cap canvas RAM/GPU at ~23 MB (2400² × 4 bytes).
const MAX_CANVAS_PX = 2400

function parseFontSize(font: string | number | undefined): number {
  if (font == null) return 0.7
  if (typeof font === 'number') return font
  const m = font.match(/^([0-9.]+)(px)?/)
  if (!m) return 0.7
  const size = parseFloat(m[1])
  return m[2] ? size / TILE : size
}

function parseFontFamily(font: string | number | undefined): string {
  if (typeof font !== 'string') return 'sans-serif'
  const m = font.match(/^[0-9.]+(px)?\s+(.+)$/)
  return m ? m[2] : 'sans-serif'
}

/**
 * PIXI 7 port of the legacy VisualLayer: draws RoomVisual primitives onto a 2D canvas each
 * tick, sized world-scale × resolution × room so canvas and screen pixels map 1:1 at any
 * zoom. The canvas rides in a sprite on the renderer stage; the ticker watches for zoom
 * changes and re-bakes once the zoom settles.
 */
export class VisualOverlay {
  private readonly gameApp: GameRenderer
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly sprite: import('pixi7').Sprite
  private texture: import('pixi7').Texture
  private readonly resolution: number
  private lastRaw = ''
  private lastPhysSize = 0
  private prevScale = -1

  constructor(gameApp: GameRenderer) {
    this.gameApp = gameApp
    this.resolution = gameApp.app.renderer.resolution
    const PIXI = pixi7()

    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d')!

    const physSize = this.idealPhysSize()
    this.canvas.width = physSize
    this.canvas.height = physSize
    this.lastPhysSize = physSize

    // A fresh BaseTexture per canvas (never Texture.from, which caches by source and would
    // hand back stale dimensions after a resize).
    this.texture = new PIXI.Texture(new PIXI.BaseTexture(this.canvas))
    this.sprite = new PIXI.Sprite(this.texture)
    this.sprite.eventMode = 'none'
    this.sprite.zIndex = OVERLAY_Z.visuals
    // The room's top-left corner sits at world (-CELL_SIZE/2, -CELL_SIZE/2).
    this.sprite.position.set(-CELL_SIZE / 2, -CELL_SIZE / 2)
    this.sprite.scale.set(VIEW_BOX / physSize)

    gameApp.app.stage.addChild(this.sprite)
    gameApp.app.ticker.add(this.onTick, this)
  }

  private idealPhysSize(): number {
    return Math.min(Math.ceil(this.gameApp.zoomLevel * this.resolution * VIEW_BOX), MAX_CANVAS_PX)
  }

  private onTick(): void {
    const scale = this.gameApp.zoomLevel
    const physSize = this.idealPhysSize()
    // Only resize+redraw once zoom settles (scale stable for one frame), not on every zoom frame.
    if (scale === this.prevScale && physSize !== this.lastPhysSize && this.lastRaw) {
      this.resizeTo(physSize)
      this.redraw()
    }
    this.prevScale = scale
  }

  update(raw: string): void {
    this.lastRaw = raw
    const physSize = this.idealPhysSize()
    if (physSize !== this.lastPhysSize) this.resizeTo(physSize)
    this.redraw()
  }

  private resizeTo(physSize: number): void {
    this.canvas.width = physSize
    this.canvas.height = physSize

    const PIXI = pixi7()
    const oldTexture = this.texture
    this.texture = new PIXI.Texture(new PIXI.BaseTexture(this.canvas))
    this.sprite.texture = this.texture
    this.sprite.scale.set(VIEW_BOX / physSize)

    oldTexture.destroy(true)
    this.lastPhysSize = physSize
  }

  private redraw(): void {
    const { ctx, canvas } = this
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!this.lastRaw) {
      this.sprite.visible = false
      this.texture.baseTexture.update()
      return
    }

    const drawScale = canvas.width / ROOM
    ctx.save()
    ctx.scale(drawScale, drawScale)

    for (const line of this.lastRaw.split('\n')) {
      if (!line.trim()) continue
      let entry: RoomVisualEntry
      try { entry = JSON.parse(line) } catch { continue }

      const s = entry.s ?? {}
      const alpha = s.opacity ?? 1

      switch (entry.t) {
        case 'l': this.drawLine(entry, s, alpha); break
        case 'c': this.drawCircle(entry, s, alpha); break
        case 'r': this.drawRect(entry, s, alpha); break
        case 'p': this.drawPoly(entry, s, alpha); break
        case 't': this.drawText(entry, s, alpha); break
      }
    }

    ctx.restore()
    this.texture.baseTexture.update()
    this.sprite.visible = true
  }

  private drawLine(e: Extract<RoomVisualEntry, {t:'l'}>, s: VisualStyle, alpha: number): void {
    const { ctx } = this
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.strokeStyle = s.color ?? '#ffffff'
    ctx.lineWidth = (s.width ?? 0.1) * TILE
    ctx.setLineDash(s.lineStyle === 'dotted' ? DASH_PX.dotted : s.lineStyle === 'dashed' ? DASH_PX.dashed : [])
    ctx.beginPath()
    ctx.moveTo(tp(e.x1), tp(e.y1))
    ctx.lineTo(tp(e.x2), tp(e.y2))
    ctx.stroke()
    ctx.restore()
  }

  private drawCircle(e: Extract<RoomVisualEntry, {t:'c'}>, s: VisualStyle, alpha: number): void {
    const { ctx } = this
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.setLineDash(s.lineStyle === 'dotted' ? DASH_PX.dotted : s.lineStyle === 'dashed' ? DASH_PX.dashed : [])
    ctx.beginPath()
    ctx.arc(tp(e.x), tp(e.y), (s.radius ?? 0.5) * TILE, 0, 2 * Math.PI)
    if (s.fill && s.fill !== 'transparent') { ctx.fillStyle = s.fill; ctx.fill() }
    if (s.stroke && s.strokeWidth) { ctx.strokeStyle = s.stroke; ctx.lineWidth = s.strokeWidth * TILE; ctx.stroke() }
    ctx.restore()
  }

  private drawRect(e: Extract<RoomVisualEntry, {t:'r'}>, s: VisualStyle, alpha: number): void {
    const { ctx } = this
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.setLineDash(s.lineStyle === 'dotted' ? DASH_PX.dotted : s.lineStyle === 'dashed' ? DASH_PX.dashed : [])
    ctx.beginPath()
    ctx.rect(tp(e.x), tp(e.y), e.w * TILE, e.h * TILE)
    if (s.fill && s.fill !== 'transparent') { ctx.fillStyle = s.fill; ctx.fill() }
    if (s.stroke && s.strokeWidth) { ctx.strokeStyle = s.stroke; ctx.lineWidth = s.strokeWidth * TILE; ctx.stroke() }
    ctx.restore()
  }

  private drawPoly(e: Extract<RoomVisualEntry, {t:'p'}>, s: VisualStyle, alpha: number): void {
    if (!e.points?.length) return
    const { ctx } = this
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.setLineDash(s.lineStyle === 'dotted' ? DASH_PX.dotted : s.lineStyle === 'dashed' ? DASH_PX.dashed : [])
    ctx.beginPath()
    ctx.moveTo(tp(e.points[0][0]), tp(e.points[0][1]))
    for (let i = 1; i < e.points.length; i++) ctx.lineTo(tp(e.points[i][0]), tp(e.points[i][1]))
    if (s.fill && s.fill !== 'transparent') { ctx.fillStyle = s.fill; ctx.fill() }
    if (s.stroke && s.strokeWidth) { ctx.closePath(); ctx.strokeStyle = s.stroke; ctx.lineWidth = s.strokeWidth * TILE; ctx.stroke() }
    ctx.restore()
  }

  private drawText(e: Extract<RoomVisualEntry, {t:'t'}>, s: VisualStyle, alpha: number): void {
    const { ctx } = this
    const fontSize = parseFontSize(s.font) * TILE
    const fontFamily = parseFontFamily(s.font)
    const align = (s.align ?? 'left') as CanvasTextAlign
    const x = tp(e.x), y = tp(e.y)

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.font = `${fontSize}px ${fontFamily}`
    ctx.textAlign = align
    ctx.textBaseline = 'middle'

    if (s.backgroundColor && s.backgroundColor !== 'transparent') {
      const tw = ctx.measureText(e.text).width
      const pad = (s.backgroundPadding ?? 0.3) * TILE
      const ax = align === 'center' ? 0.5 : align === 'right' ? 1 : 0
      ctx.fillStyle = s.backgroundColor
      ctx.fillRect(x - ax * tw - pad, y - fontSize / 2 - pad, tw + pad * 2, fontSize + pad * 2)
    }

    ctx.fillStyle = s.color ?? '#ffffff'
    if (s.stroke && s.strokeWidth) {
      ctx.strokeStyle = s.stroke
      ctx.lineWidth = s.strokeWidth * TILE
      ctx.lineJoin = 'round'
      ctx.strokeText(e.text, x, y)
    }
    ctx.fillText(e.text, x, y)
    ctx.restore()
  }

  destroy(): void {
    this.gameApp.app.ticker.remove(this.onTick, this)
    this.texture.destroy(true)
    this.sprite.parent?.removeChild(this.sprite)
    this.sprite.destroy()
  }
}
