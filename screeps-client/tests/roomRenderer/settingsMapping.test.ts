import { describe, it, expect } from 'vitest'
import {
  rebuildRequired,
  refreshRequired,
  toGameData,
  toLighting,
  type RoomRenderSettings,
} from '../../src/roomRenderer/adapters/settingsMapping'

const defaults: RoomRenderSettings = {
  showCreepLabels: true,
  terrainEffects: true,
  roomDarkOverlay: true,
  smoothAnimations: true,
}

describe('settingsMapping', () => {
  it('maps labels and terrain effects into gameData', () => {
    expect(toGameData(defaults, 'u1')).toEqual({
      player: 'u1',
      showMyNames: { spawns: true, creeps: true },
      showEnemyNames: { spawns: false, creeps: true },
      showFlagsNames: true,
      showCreepSpeech: true,
      swampTexture: 'animated',
    })
    const off = toGameData({ ...defaults, showCreepLabels: false, terrainEffects: false }, 'u1')
    expect(off.showMyNames).toEqual({ spawns: false, creeps: false })
    expect(off.showEnemyNames.creeps).toBe(false)
    expect(off.swampTexture).toBe('disabled')
  })

  it('maps the dark overlay setting to lighting', () => {
    expect(toLighting(defaults)).toBe('normal')
    expect(toLighting({ ...defaults, roomDarkOverlay: false })).toBe('disabled')
  })

  it('requires a rebuild only for lighting changes', () => {
    expect(rebuildRequired(defaults, { ...defaults, roomDarkOverlay: false })).toBe(true)
    expect(rebuildRequired(defaults, { ...defaults, showCreepLabels: false })).toBe(false)
    expect(rebuildRequired(defaults, defaults)).toBe(false)
  })

  it('requires a scene refresh for label and terrain-effect changes', () => {
    expect(refreshRequired(defaults, { ...defaults, showCreepLabels: false })).toBe(true)
    expect(refreshRequired(defaults, { ...defaults, terrainEffects: false })).toBe(true)
    expect(refreshRequired(defaults, { ...defaults, smoothAnimations: false })).toBe(false)
    expect(refreshRequired(defaults, { ...defaults, roomDarkOverlay: false })).toBe(false)
  })
})
