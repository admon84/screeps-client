import type { GameData, Metadata, WorldConfigs } from '@screeps/renderer'

export const CELL_SIZE = 100
export const ROOM_SIZE = 50
export const VIEW_BOX = CELL_SIZE * ROOM_SIZE

/** Server endpoint template; only a fallback -- badge URLs are normally injected locally (see adapters/badgeUrls.ts). */
export const BADGE_URL_TEMPLATE = 'api/user/badge-svg?username=%1'

export interface BuildWorldConfigsOptions {
  metadata: Metadata
  gameData: GameData
  lighting: WorldConfigs['lighting']
}

export function buildWorldConfigs({ metadata, gameData, lighting }: BuildWorldConfigsOptions): WorldConfigs {
  return {
    ATTACK_PENETRATION: 10,
    CELL_SIZE,
    ROOM_SIZE,
    VIEW_BOX,
    RENDER_SIZE: { width: 2048, height: 2048 },
    userOwnerColor: true,
    BADGE_URL: BADGE_URL_TEMPLATE,
    metadata: patchMetadata(metadata),
    gameData,
    lighting,
    forceCanvas: false,
  }
}

/**
 * Two upstream fixups, applied before compileMetadata:
 * - the mineral letter is styled `Roboto, serif`; every other metadata label uses `Roboto,
 *   sans-serif`, so without Roboto loaded the mineral alone falls back to a serif face
 * - the setBadgeUrls preprocessor overwrites users[id].badgeUrl from BADGE_URL on every
 *   applyState; badge URLs are injected locally instead, so it must not run
 */
export function patchMetadata(metadata: Metadata): Metadata {
  const textProcessor = metadata.objects.mineral?.processors?.find((p) => p.type === 'text')
  const style = textProcessor?.payload?.style
  if (style && typeof style === 'object' && 'fontFamily' in style) style.fontFamily = 'Roboto, sans-serif'
  metadata.preprocessors = metadata.preprocessors.filter((name) => name !== 'setBadgeUrls')
  return metadata
}
