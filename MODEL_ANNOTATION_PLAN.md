# 3D Model Viewing & Annotation Plan

Add frame-accurate 3D model viewing and **surface-anchored collaborative annotation**
for `3d_model` assets, ported from `/development/collaboration`.

## Why this is a small feature

nexus8's annotator is already a descendant of the collaboration project's annotation
system. The following are **already in place and proven** with image + video:

- **Collaboration** — Yjs CRDT room + WebSocket awareness
  (`web/src/features/annotator/core/collaboration/broadcast.ts`) with a running relay
  (`web/relay/yjs-websocket-server.mjs`, Postgres-backed). Annotations sync live.
- **Data model already supports 3D** — `AnnotationFrame` in
  `core/annotations/types.ts` has `space: 'image2d' | 'world3d'`, a 3D
  `origin`/`xAxis`/`yAxis` plane, and an optional `cameraView` snapshot
  (position/target/radius/theta/phi). This is exactly the collaboration 3D anchor model.
- **Pluggable viewer adapters** — `core/viewers/adapters.ts` defines the `ViewerAdapter`
  seam. Image (`tiledImageAdapter`) and video (`videoAdapter`) are real adapters; the
  existing `world3d` `worldViewerAdapter` is only a fake **isometric** projection stub.
- **Canvas overlay rendering, undo/redo, layers, REST persistence** — all space-agnostic.

So the work is essentially: replace the isometric stub with a real Three.js adapter and
route 3D assets to it.

## Decisions (from analysis + user)

- **Annotation style:** Surface-anchored 2D (port as-is). Freehand / shapes / text are
  drawn on a 2D plane anchored to the picked 3D surface point + normal, with the camera
  view snapshotted into the frame so selecting an annotation can restore the viewpoint.
- **Model size / streaming:** **No streaming/LOD.** Investigation of the collaboration
  source showed its LOD/streaming system is demo scaffolding — it loads one real GLB and
  its glTF LOD swap is a no-op (all tiers point to the same file). We load a single GLB
  directly and keep the Draco/KTX2/Meshopt decoders wired for compressed assets. If models
  ever get large, compress once at ingest (Draco) rather than add runtime LOD.
- **Formats (v1):** GLB/glTF only (web-native, zero conversion). `MediaAsset.is_3d_model()`
  already also matches `.fbx/.obj/.blend`; server-side conversion to GLB is a future phase.
- **Backend:** **Reuse the existing annotation doc + endpoints unchanged.** The annotation
  document is keyed by `target_asset_id` and the `space` discriminator lives inside the
  Yjs `doc_state`, so a 3D asset reuses `/api/library/annotations/` with no migration and
  no new entity. (A dedicated `3d_model_annotation` entity + `viewer_state` default-camera
  field is a possible later refinement, not needed for v1.)

## Licensing

All permissive / open source: three.js (MIT), Yjs (MIT), GLTFLoader + DRACOLoader +
KTX2Loader + MeshoptDecoder (three.js / Khronos, permissive).

## Implementation

### 1. Dependencies & assets — DONE
- `npm i three @types/three` in `web/`.
- Decoder assets staged in `web/public/`:
  - `public/decoders/draco/gltf/` (Draco wasm decoder)
  - `public/transcoders/basis/` (KTX2 / Basis transcoder)

### 2. `web/src/features/annotator/core/viewers/threeModelViewerAdapter.ts` (new)
Self-contained `ViewerAdapter` for `space: 'world3d'`, ~9 the lines of the collaboration
`threeSceneAdapter` with all streaming/worker/manifest/procedural code dropped:
- `mountSurface(host)` → `WebGLRenderer` (sRGB + ACES), `PerspectiveCamera` (Y-up),
  neutral IBL via `RoomEnvironment` + PMREM (no external HDR file), hemisphere/dir lights,
  a faint ground grid, then `GLTFLoader` (with Draco/KTX2/Meshopt) loads the single model,
  fits it to a normalized box sitting on the ground, and frames the camera.
- Orbit / pan / wheel-zoom camera (spherical `radius/theta/phi` around a `target`).
- `screenToWorld` raycasts the mesh (fallback: ground plane) and stashes a
  surface-oriented frame (origin + tangent basis from the hit normal) + camera snapshot;
  `createFrame` returns it. `project` uses `camera.project()`; `screenToFrameLocal`
  intersects the annotation's own plane. `getProjectionRevision` keys off camera state so
  the overlay re-projects every orbit.
- `onSelectionChange` restores `frame.cameraView`. `getActions` exposes shaded / wireframe
  toggles + "Frame model". `targetId` is parameterized to `asset-<id>` so 3D annotations
  bind per-asset, consistent with image/video.

### 3. `web/src/features/annotator/AnnotatorPage.tsx`
- Add `assetIs3DModel(asset)` (media_type in `3d_model|geometry|mesh` or extension
  `.glb/.gltf/.fbx/.obj/.blend`).
- In the adapter effect, route 3D assets to `createThreeModelViewerAdapter({ src, targetId })`
  before the image fallback. Header label → "3D model annotation".

### 4. `web/src/features/annotator/components/AnnotationViewport.tsx`
- `world3d` already gets a tool subset (`select/freehand/rectangle/ellipse`); confirm it
  renders and reads cleanly for 3D. Footer already prints "World-space anchors".

### 5. Verify
- `npm run build` / typecheck in `web/`.
- Manual: open a `.glb` asset in the annotator, orbit/zoom, draw a freehand stroke on the
  surface, confirm it sticks while orbiting, reload to confirm persistence, and open a
  second tab to confirm live collaboration through the existing relay.

## Out of scope (future)
- Dedicated `3d_model_annotation` entity + default `viewer_state`.
- Server-side FBX/OBJ → GLB conversion at ingest.
- True 3D markers/measurement tools.
- Runtime LOD streaming (only if very large models appear).
</content>
</invoke>
