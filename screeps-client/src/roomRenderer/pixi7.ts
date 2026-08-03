export type Pixi7 = typeof import('pixi7')

// The renderer bundles PIXI 7.4.3 and assigns window.PIXI at module load. Everything in
// src/roomRenderer/ must use this accessor -- importing pixi.js (v8, used by the map view)
// here would mix two PIXI versions in one scene graph.
export function pixi7(): Pixi7 {
  const p = (window as { PIXI?: Pixi7 }).PIXI
  if (!p) throw new Error('window.PIXI is not set -- loadRenderer() must complete first')
  return p
}
