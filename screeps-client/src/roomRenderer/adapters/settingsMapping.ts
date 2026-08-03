import type { GameData, WorldConfigs } from '@screeps/renderer'

export interface RoomRenderSettings {
  showCreepLabels: boolean
  terrainEffects: boolean
  roomDarkOverlay: boolean
  smoothAnimations: boolean
}

export function toGameData(settings: RoomRenderSettings, playerId: string): GameData {
  return {
    player: playerId,
    showMyNames: { spawns: settings.showCreepLabels, creeps: settings.showCreepLabels },
    showEnemyNames: { spawns: false, creeps: settings.showCreepLabels },
    showFlagsNames: true,
    showCreepSpeech: true,
    swampTexture: settings.terrainEffects ? 'animated' : 'disabled',
  }
}

export function toLighting(settings: RoomRenderSettings): WorldConfigs['lighting'] {
  return settings.roomDarkOverlay ? 'normal' : 'disabled'
}

/** Lighting is baked into the layer setup at world init, so this toggle needs a full GameRoom rebuild. */
export function rebuildRequired(prev: RoomRenderSettings, next: RoomRenderSettings): boolean {
  return prev.roomDarkOverlay !== next.roomDarkOverlay
}

/** gameData is re-read per applyState, but existing sprites keep their labels/textures: erase + full re-apply. */
export function refreshRequired(prev: RoomRenderSettings, next: RoomRenderSettings): boolean {
  return prev.showCreepLabels !== next.showCreepLabels || prev.terrainEffects !== next.terrainEffects
}
