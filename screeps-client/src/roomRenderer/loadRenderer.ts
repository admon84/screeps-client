import type { GameRenderer, Metadata } from '@screeps/renderer'

export interface RendererModule {
  GameRenderer: typeof GameRenderer
  metadata: Metadata
}

let loaded: Promise<RendererModule> | undefined

// Import order is load-bearing: @screeps/renderer sets window.PIXI as a module side effect,
// and @screeps/renderer-metadata reads that global at eval time to build RENDERER_METADATA.
// This must stay the only import site of either package.
export function loadRenderer(): Promise<RendererModule> {
  loaded ??= (async () => {
    const { GameRenderer } = await import('@screeps/renderer')
    patchSvgDetection()
    await import('@screeps/renderer-metadata')
    const metadata = (window as unknown as { RENDERER_METADATA?: Metadata }).RENDERER_METADATA
    if (!metadata) throw new Error('RENDERER_METADATA global missing after importing @screeps/renderer-metadata')
    return { GameRenderer, metadata }
  })()
  return loaded
}

/**
 * The bundled PIXI 7's SVGResource.SVG_XML regex is broken: its comment matcher
 * `[^(-->)]*` is a character class excluding ( - > ), so any SVG whose leading comment
 * contains one of those (38 of the Inkscape-authored metadata sprites: "<!-- Created with
 * Inkscape (http://...) -->") fails detection. The Assets loader then caches the raw SVG
 * TEXT instead of a Texture, and the first `new Sprite(<string>)` throws, aborting the
 * renderer's whole apply loop. Must run before any asset loads.
 */
function patchSvgDetection(): void {
  const svgResource = (window as unknown as {
    PIXI: { SVGResource: { SVG_XML: RegExp } }
  }).PIXI.SVGResource
  svgResource.SVG_XML = /^(<\?xml[^?]*\?>)?\s*(<!--[\s\S]*?-->\s*)*<svg/m
}
