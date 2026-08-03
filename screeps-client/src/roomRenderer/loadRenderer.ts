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
    await import('@screeps/renderer-metadata')
    const metadata = (window as unknown as { RENDERER_METADATA?: Metadata }).RENDERER_METADATA
    if (!metadata) throw new Error('RENDERER_METADATA global missing after importing @screeps/renderer-metadata')
    return { GameRenderer, metadata }
  })()
  return loaded
}
