import type { ApiRoomDecorationGraphic, ApiRoomDecorationItem } from 'screeps-connectivity'
import type { DecorationItem } from '@screeps/renderer'

/**
 * setDecorations expects the user-configured `active` props flattened onto the item root
 * (x/y/width/height/rotation/colors/...) next to the nested `decoration` def, with numeric
 * fields as numbers -- the API may deliver them as strings.
 */
export function toRendererDecorations(
  items: readonly ApiRoomDecorationItem[],
  resolveUrl: (url: string) => string = (url) => url,
): DecorationItem[] {
  return items.map((item) => ({
    _id: item._id,
    user: item.user,
    decoration: resolveDecorationUrls(item.decoration, resolveUrl),
    ...coerceValues(item.active),
  }))
}

function resolveDecorationUrls(
  decoration: ApiRoomDecorationItem['decoration'],
  resolveUrl: (url: string) => string,
): DecorationItem['decoration'] {
  return {
    ...decoration,
    ...(decoration.foregroundUrl ? { foregroundUrl: resolveUrl(decoration.foregroundUrl) } : {}),
    ...(decoration.floorForegroundUrl ? { floorForegroundUrl: resolveUrl(decoration.floorForegroundUrl) } : {}),
    ...(decoration.graphics
      ? { graphics: decoration.graphics.map((g: ApiRoomDecorationGraphic) => ({ ...g, url: resolveUrl(g.url) })) }
      : {}),
  }
}

function coerceValues(active: ApiRoomDecorationItem['active']): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key in active) {
    const value = active[key]
    if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) result[key] = Number(value)
    else if (value === 'true') result[key] = true
    else if (value === 'false') result[key] = false
    else result[key] = value
  }
  return result
}
