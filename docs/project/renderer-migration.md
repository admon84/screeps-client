# Room Rendering Migration to @screeps/renderer

Status: Phases 1-6 landed on the renderer-migration branch; the new view is
feature-complete behind the "Official room renderer (experimental)" setting.
Phases 3-5 are user-verified against a live server; Phase 6 (decorations) is
headless-verified and needs an in-session pass. Remaining: Phase 7 cutover
(flip the default for a release, then delete the legacy pipeline).

Implementation notes so far:
- rescaleResources is omitted: v1.6.10 never reads it (verified against the
  bundle source), so only resourceMap is passed.
- The manualChunks rule excludes @screeps/renderer-metadata/images/ -- the ?url
  sprite modules are statically imported via resourceMap.ts, and grouping them
  into the renderer chunk would modulepreload the whole 858 kB bundle eagerly.
- setCurrentRoom/Shard moved into useRoomTerrain (used by GameRoomViewer);
  RoomViewer keeps its inline copy until Phase 7 deletes it.
- Found during Phase 3 verification: the bundled PIXI 7's SVGResource.SVG_XML
  regex rejects SVGs whose leading comment contains ( - > ) -- 38 of the 119
  metadata sprites (the Inkscape-authored ones) then cache as raw TEXT and the
  first `new Sprite(<string>)` aborts the renderer's entire apply loop (no
  objects render at all). loadRenderer.ts patches the regex before any asset
  loads. Reproduced and verified fixed with a headless synthetic-room render.
- Known polish item: userBadge sprites Assets.add the same badge data URL on
  every rebuild -> harmless "[Assets] already has key" console warnings.
- The renderer is ONE INSTANCE PER ROOM: navigation releases and recreates the
  GameRoom (serialized by the construction handoff). The engine leaks state
  across rooms otherwise -- old-room landscape recolors on new-room walls,
  ghost action beams (effect sprites parent to the stage, not the creep), and
  a lighting-composite corruption that survived every targeted reset we tried
  (erase + decoration clear + terrain md5 reset + action-manager sweep).
  Room-switch cost is a renderer rebuild (~0.5s); assets are inline data URLs
  so no network refetch is involved.
- setDecorations' own container teardown uses destroy({texture: true}), which
  destroys URL-cached textures shared with other sprites (terrain noise, any
  later Sprite.from of the same URL). GameRoom pre-empts it by destroying the
  container itself with textures kept, and GCs action handles pointing at
  destroyed sprites after each rebuild (Repeat animations never self-end).

## Context

The client renders rooms with a fully custom pipeline
(`screeps-client/src/renderer/`: RoomRenderer camera, TerrainLayer, ObjectLayer
~1800 lines, ActionAnimationLayer, VisualLayer, HoverHighlightLayer,
LightingLayer, DecorationLayer, 30 per-object visual modules, partial
atlas/theme system). Maintaining visual parity with the official client by hand
is a treadmill. `@screeps/renderer` v1.6.10 is the engine the official client
uses -- exactly what this project is. The local project
`~/repos/screeps-room-planner` is a working React integration used as the
reference implementation throughout ("the planner" below).

Goal: completely switch room rendering to `@screeps/renderer` at full feature
parity (RoomVisuals, hover/selection, decoration editor, history mode), then
delete the legacy room pipeline. The world-map view keeps its custom PIXI v8
renderer.

Decisions:
- Direct replacement on a branch (dev-time settings flag during Phases 3-6,
  removed at cutover) -- no long-lived dual pipeline.
- Full parity bar -- features without renderer equivalents become overlay
  containers on the renderer stage (renderer occupies zIndex 0..6 with
  sortableChildren; overlays go at zIndex >= 100).
- Wall graffiti/decorations move to the renderer's native `setDecorations()`;
  the in-room decoration editor overlays on top and feeds it.
- The map view stays on PIXI v8 -- no downgrade to the renderer's PIXI 7.
  Downgrading would rewrite a working subsystem onto v7's breaking-different
  Graphics/Application APIs, accessed only through an untyped window global
  that exists after the renderer's ~2 MB chunk loads. The duality's real cost
  is one lazy chunk for map visitors (~150 KB gzip once vendor-pixi moves
  behind the map view's lazy boundary in Phase 7). If "one PIXI" ever becomes
  a goal, the path is a renderer fork on modern PIXI, not a map downgrade.

## Renderer facts (verified from bundle source + planner reference)

- UMD CJS bundle, PIXI 7.4.3 fully inlined; sets `window.PIXI` as a module side
  effect. `@screeps/renderer-metadata` must be imported AFTER it (reads the
  global at eval time; sets `window.RENDERER_METADATA`). `pixi.js@7` needed only
  as a types devDependency. ~2 MB, not tree-shakeable -- lazy-load.
- No published types. Adapt the planner's hand-written
  `src/types/declarations.d.ts` (525 lines); known fixes: `compileMetadata` is
  sync, `init` takes an HTMLElement, `isWebGLSupported()` is a static method.
- API: `new GameRenderer({size, resourceMap, worldConfigs, onGameLoop,
  countMetrics, backgroundColor})`; `await init(containerDiv)` (creates its own
  canvas); `applyState(state, tickSeconds)`; `setTerrain(sparse)`; `zoomLevel`
  get/set, `pan(dx,dy)`, `zoomTo(v,x,y)`, `resize({width,height})` (no-arg is a
  no-op); `erase()`; `setDecorations(items)` (WebGL only); `release()`;
  `static compileMetadata(md)`. Not an EventEmitter -- interaction via PIXI
  stage events (`stage.eventMode = 'static'`).
- State: `{ objects: flat array, users, gameTime, info, flags, visual }`.
  Identity `_id` (fallback `room:type:x:y`); omission = delete; unknown types
  only warn. Terrain: sparse `{room,x,y,type:'wall'|'swamp'}`; plain = absence.
- Metadata natively covers what the custom code hand-rolls: terrain + ramparts,
  roads, all structures, creep motion interpolation, actionLog beams
  (creepActions), say bubbles, lighting layer, effects, badges, decorations
  (wallGraffiti/landscape incl. terrain/road recoloring via
  `world.decorations`). tickDuration is SECONDS (`TimeableAction` does
  `time * 1000`).
- `world.gameObjects` (id -> GameObject with `.rootContainer`) is exposed --
  replaces `ObjectLayer.getVisualById` for selection-ring tracking.
- worldConfigs: `CELL_SIZE: 100`, `VIEW_BOX: 5000`, `ROOM_SIZE: 50`
  (undocumented but mandatory or setTerrain throws), `RENDER_SIZE
  {2048,2048}`, `ATTACK_PENETRATION: 10`, `BADGE_URL` (`%1` = username),
  `userOwnerColor: true` (rampart fill green self / red hostile without user
  colors -- matches official), `metadata` (patched + compiled), `gameData
  {player, showMyNames, showEnemyNames, showFlagsNames, showCreepSpeech,
  swampTexture}`, `lighting: 'normal'|'disabled'`.
- Badges can be fully local: strip `'setBadgeUrls'` from
  `metadata.preprocessors` and inject `users[id].badgeUrl` as
  `data:image/svg+xml` via connectivity's `badgeToSvg` (RoomStore already
  delivers badge objects). Endpoint fallback
  `${httpBaseUrl}api/user/badge-svg?username=%1` for users without one.

## Target architecture

- `src/renderer/` -- stays PIXI 8, map view only after cutover.
- `src/roomRenderer/` -- new, PIXI 7 world; never imports `pixi.js` (enforce via
  `no-restricted-imports` scoped to the dir in eslint config); no Solid signals
  inside (repo rule). Types via devDep alias `"pixi7": "npm:pixi.js@7.4.3"`.

```
screeps-client/src/roomRenderer/
  pixi7.ts            lazy accessor for window.PIXI (exists after loadRenderer())
  loadRenderer.ts     ordered dynamic imports -> { GameRenderer, metadata }
  resourceMap.ts      126 `?url` imports from @screeps/renderer-metadata/images/
                      + rescaleResources (generated once by
                      scripts/generate-renderer-resource-map.mjs, committed)
  worldConfigs.ts     buildWorldConfigs(opts); patches mineral fontFamily and
                      strips setBadgeUrls before compileMetadata
  GameRoom.ts         lifecycle wrapper: handoff serialization, create/init,
                      applyTerrain/applyState/applyDecorations, eraseObjects,
                      getObjectContainer(id), resize, release
  RoomCamera.ts       port of RoomRenderer camera: pan/pinch/wheel/elastic/
                      spring-back/nav zones/screenToTile/viewTransform/
                      setTileHandlers/setCameraLocked
  hitTest.ts          pure objectsAtTile(objects: RoomObjectMap, tx, ty)
  adapters/
    stateAdapter.ts   RoomObjectMap -> fresh state envelope (applyState MUTATES
                      and retains refs -- always shallow-copy objects)
    terrainAdapter.ts RoomTerrain.raw Uint8Array -> sparse wall/swamp array
    badgeUrls.ts      users -> users with data-URL badgeUrl (+ endpoint fallback)
    decorationAdapter.ts  ApiRoomDecorationItem[] -> flattened renderer items
                      ({...item, ...coerceNumbers(item.active)})
    settingsMapping.ts    pure settings -> { gameData, lighting, rebuildRequired }
  overlays/
    HoverOverlay.ts   PIXI7 port of HoverHighlightLayer (hover rect, pending
                      crosshair, selection rings tracking gameObjects)
    VisualOverlay.ts  PIXI7 port of VisualLayer (RoomVisual canvas -> sprite)
screeps-client/src/types/screeps-renderer.d.ts   adapted planner declarations
screeps-client/src/components/roomView/          shared orchestration (Phase 2)
screeps-client/src/components/GameRoomViewer.tsx new viewer component
```

Coordinate port is mechanical: `World` sets `stage.pivot = -CELL_SIZE/2`, so
`stage.position` is the screen position of the room's top-left corner -- the
same contract RoomRenderer exposes today. Substitutions: TILE_SIZE 12 ->
CELL_SIZE 100, ROOM px 600 -> 5000, max zoom 5 -> 0.6.

Camera-contract consumers are narrower than feared: `viewTransform` /
`setCameraLocked` / `screenToTile` / `setTileHandlers` are consumed only inside
RoomViewer.tsx; PlacementFrame receives plain numbers; Dashboard just hosts the
viewer.

## Phases (each leaves build + lint + test green and the client working)

### Phase 1 -- Inert bootstrap
- devDeps in `screeps-client/package.json`: `@screeps/renderer@1.6.10`,
  `@screeps/renderer-metadata@1.6.10` (pin exact -- vendored-artifact posture),
  `pixi7: npm:pixi.js@7.4.3`.
- `vite.config.ts`: `optimizeDeps.include` both packages; manualChunks
  `vendor-screeps-renderer` for `/node_modules/@screeps/`.
- Create types, `pixi7.ts`, `loadRenderer.ts`, `worldConfigs.ts`,
  `resourceMap.ts` (+ generator script), all `adapters/`, `hitTest.ts`.
- Asset strategy: `?url` imports, NOT a public/ copy -- works across all FOUR
  build outputs (standalone, embedded `/client/` base, xxscreeps-mod, and
  `build:bundle` single-file which inlines them as data URLs), gets hashed
  immutable-cache filenames from the mod servers, and sidesteps the existing
  Vite dev proxy on `/assets` entirely. renderer-metadata has no `exports`
  field, so deep image imports are legal.
- Tests: `tests/roomRenderer/{terrainAdapter,stateAdapter,badgeUrls,
  settingsMapping,decorationAdapter,hitTest}.test.ts` (stateAdapter asserts
  output objects are not input references).
- Verify: all four builds succeed; new chunk absent from eager graph.

### Phase 2 -- Extract shared orchestration (pure refactor, legacy still renders)
- `src/components/roomView/roomStats.ts` -- the object-summarize loop currently
  duplicated at RoomViewer.tsx ~252 (live) and ~349 (history); pure
  `accumulateRoomStats(objects, users)` + publisher. Test it.
- `src/components/roomView/useRoomSubscription.ts` (room:update effect),
  `useRoomHistory.ts` (HistoryPlayer wiring), `useRoomDecorationItems.ts`
  (HTTP fetch + socket merge).
- RoomViewer.tsx consumes the extractions; behavior unchanged. Manual smoke:
  live, history, decorations, flag/build modes.

### Phase 3 -- GameRoomViewer behind a dev flag (terrain + objects + camera)
- `GameRoom.ts` (planner `useGameRenderer.ts` translated to Solid lifecycle):
  module-scope `rendererHandoff` promise serializing create-after-release;
  `compileMetadata`; `PIXI.settings.RESOLUTION = devicePixelRatio` BEFORE
  construction; after init `(app.renderer as any)._view.autoDensity = true` +
  explicit `resize({w,h})`; ResizeObserver; cancellation guards on every await.
- `RoomCamera.ts` -- port `RoomRenderer.setupCamera`/`clampView`/spring-back/
  `setupNavigationZones` with the constant substitutions; listeners on
  `gameApp.app.view`; PIXI7 Graphics API (beginFill/drawPolygon).
- `GameRoomViewer.tsx`: terrain effect (`applyTerrain`); state effect --
  `applyState(objs, users, gameTime, tickSeconds)` where `tickSeconds =
  (historyMode ? 1000/playbackSpeed : tickDuration() ?? 2000) / 1000`, forced 0
  when history or !smoothAnimations. The entire actionLog walk (RoomViewer
  ~910-990) disappears -- beams/say/aim/interpolation are metadata-native. No
  heartbeat interval needed: room:update arrives every tick. Room switch:
  `eraseObjects()` + re-terrain + nav-zone rebuild.
- Settings flag: `boolSetting(LS.useOfficialRenderer, false)` in
  settingsStore.ts + SettingsPanel toggle; Dashboard picks the viewer.
- Verify (manual, flag ON): ramparts green/red, roads joining, smooth creep
  motion, badges (data URLs render -- if PIXI7 balks at data: SVG, fall back to
  BADGE_URL endpoint), swamp animation, say bubbles, action beams, nav arrows,
  pinch/wheel/elastic, resize, 10x room switch without texture-cache errors,
  history seek. Flag OFF unchanged.

### Phase 4 -- Interaction parity
- `overlays/HoverOverlay.ts`; creep selection rings track
  `gameRoom.getObjectContainer(id)` on the app ticker; lives at zIndex >= 100.
- Transplant RoomViewer's click state machine (~728-889) with three swaps:
  `getObjectsAtTile` -> pure `objectsAtTile(objectState().objects, ...)`;
  `getVisualById` -> `getObjectContainer`; `hoverLayer.*` -> `hoverOverlay.*`.
  selectionStore code untouched (operates on store data).
- Decorate-mode: `setCameraLocked`, `setViewChangeHandler`; PlacementFrame gets
  `cellSize = CELL_SIZE * scale`, `originX/Y = viewTransform().x/y` (same
  contract as before thanks to the pivot).
- Verify: select/multi-select, ring follows moving creep, flag place/move,
  build place + ctrl-click site removal, right-click reset, decoration frame
  drag/resize/rotate alignment, resize while decorating.

### Phase 5 -- RoomVisual overlay + settings mapping + history polish
- `overlays/VisualOverlay.ts`: same 2D-canvas pipeline, sprite at (-50,-50)
  sized 5000, resolution from `zoomLevel * dpr * 5000` capped 2400; PIXI7
  texture-update deltas.
- Settings reactions: showCreepLabels/terrainEffects mutate live
  `worldConfigs.gameData` then `eraseObjects()` + full re-apply (+ re-terrain
  for swamp texture); roomDarkOverlay = full GameRoom rebuild (lighting baked
  into layer afterCreate -- rare toggle, acceptable); smoothAnimations =
  tickSeconds 0 only.
- Verify foreign non-public say bubbles stay hidden (metadata gates on
  `gameData.player`; if not, strip in stateAdapter like legacy ~978).

### Phase 6 -- Native decorations
- Decoration effect -> `applyDecorations(adapted)`: `setDecorations(items)`
  THEN re-apply terrain (terrain processor reads `world.decorations` for
  landscape/road recolor -- replaces custom DecorationLayer + setRoadColor/
  setWallColor and adds landscape support the custom pipeline lacked).
- Editor live-drag: merge draft into items, rAF-throttled applyDecorations
  (Sprite.from hits texture cache; if profiling objects, reposition children of
  `world.decorationsContainer` directly for the dragged id).
- Guard with `GameRenderer.isWebGLSupported()` (setDecorations is WebGL-only).
- Verify: graffiti wall-masked + animations, floorLandscape recolor, drag at
  pointer speed, setting off clears (setDecorations([]) + re-terrain).

### Phase 7 -- Cutover and deletion
1. Default flag to true for a release; gather feedback; then remove flag and
   legacy path (GameRoomViewer becomes the RoomViewer).
2. Delete (verified consumer-free once legacy path is gone):
   `src/renderer/{RoomRenderer,ObjectLayer,TerrainLayer,ActionAnimationLayer,
   VisualLayer,HoverHighlightLayer,LightingLayer,DecorationLayer,
   StructureTextureCache(already dead),objectDecorations,decorationTextures,
   decorationAnimation}.ts` and `src/renderer/objects/` (check whether
   `objects/disabled.ts` `computeDisabledIds` has sidebar consumers first --
   it has a test and models the official disabled rule).
3. Keep (map view + UI deps): `MapRenderer.ts`, `MapVisualLayer.ts`,
   `minimap.ts`, `mapDecorations.ts`, `terrainCache.ts`, `terrain.worker.ts`,
   `decorationTextureUrl.ts`, `AtlasCache.ts`, `themes/` (trim to
   MapRenderer's frames), `BadgeTextureCache.ts` (MapRenderer imports it),
   `colors.ts`, `hsl.ts`, `roomDecorations.ts` (sidebar/CreepDetails parsing).
4. Keep `vendor-pixi` chunk (map still v8); update `docs/claude/client.md` and
   `docs/project/Room View Architecture.md`.

## Risk register

| Risk | Mitigation |
|---|---|
| `release()` destroys the GLOBAL PIXI7 texture cache; overlapping instances kill each other (remounts, dark-overlay rebuild) | module-scope handoff promise serializing create-after-release (planner useGameRenderer.ts:29-34); cancellation guards on every await |
| `applyState` mutates state and retains object refs | stateAdapter emits fresh arrays + shallow copies; unit test asserts non-identity |
| `setTerrain([])` never clears walls/swamps | port planner `clearTerrainSprites` (hide sprites + null previousWallsMd5/previousSwampsMd5) into `applyTerrain` |
| tickDuration ms-vs-seconds confusion | single conversion point in GameRoomViewer; documented on applyState |
| badge staleness (re-resolved only on user/level prop change) | track users[id].badge JSON; on change eraseObjects() + re-apply |
| data-URL SVG badges fail in PIXI7 | fallback: BADGE_URL endpoint (exists on official + standard private servers; /api proxied in dev, same-origin embedded) |
| window-global side effects lost to prod tree-shaking | loadRenderer.ts is the only import site, sequential dynamic imports; grep built output for RENDERER_METADATA/window.PIXI; test `vite preview` |
| two PIXI versions on one page | lint fence: no `pixi.js` import inside src/roomRenderer/; v7 global-only, v8 ESM-only; guard dev `__PIXI_APP__` assignment |
| lighting frozen at world init | roomDarkOverlay toggle = full rebuild via handoff |
| unknown object types on modded servers (xxscreeps) | renderer warns and skips; map known aliases in stateAdapter if noisy |
| performance (5000-unit world, SVG rasterization) | countMetrics in dev; FPS compare legacy-vs-new in a busy room during Phase 3; these are the official client's production constants |

## Verification

Per-phase manual checklists above, plus:
- Pure-logic vitest additions: P1 adapters + hitTest; P2 roomStats; P3 camera
  math extracted pure (clampPosition, spring-back target, screenToTile given
  {position, scale, containerSize}); P5 visual-overlay canvas sizing +
  rebuildRequired matrix; P6 decorationAdapter coercion/rotation edge cases.
- Every phase: `pnpm build && pnpm lint && pnpm test` (all four client build
  outputs in P1 and P7), `vite preview` smoke for the global-side-effect risk.
- End-to-end: run against a live server (dev proxy), watch a busy owned room
  for several minutes; toggle every rendering setting; full history playback;
  decoration editor session; compare side-by-side with legacy before Phase 7
  deletes it.
