import { badgeToSvg, type Badge } from 'screeps-connectivity'
import type { StateUser } from '@screeps/renderer'

export type RoomUsers = Record<string, { _id: string; username: string; badge?: Badge }>

/**
 * Injects users[id].badgeUrl locally instead of relying on the renderer's setBadgeUrls
 * preprocessor (stripped in patchMetadata): badge objects already arrive with room updates,
 * so rendering them as data URLs works on servers without the badge-svg endpoint. The
 * endpoint template is the fallback for users whose badge object is missing.
 */
export function withBadgeUrls(users: RoomUsers | undefined, fallbackTemplate: string): Record<string, StateUser> {
  const result: Record<string, StateUser> = {}
  for (const id in users) {
    const user = users[id]
    result[id] = {
      ...user,
      badgeUrl: user.badge
        ? svgDataUrl(badgeToSvg(user.badge))
        : fallbackTemplate.replace('%1', encodeURIComponent(user.username)),
    }
  }
  return result
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
