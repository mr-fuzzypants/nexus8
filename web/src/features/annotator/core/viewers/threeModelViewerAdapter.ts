import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  PMREMGenerator,
  Raycaster,
  Scene,
  Sphere,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { AnnotationFrame, Vec2, Vec3 } from '../annotations/types'
import type {
  NavigationOptions,
  ViewerAction,
  ViewerAdapter,
  ViewerSurfaceController,
  ViewportSize,
} from './adapters'

export interface ThreeModelViewerOptions {
  /** URL of the GLB/glTF model to load. */
  src: string
  /** Per-asset target id so 3D annotations bind to this model only. */
  targetId: string
  label?: string
}

type NavigationMode = 'orbit' | 'pan'
type SceneRenderMode = 'shaded' | 'wireframe'

interface ViewState {
  radius: number
  theta: number
  phi: number
  target: Vector3
}

const DEFAULT_FOV = 50
const PHI_EPSILON = 0.05

function createEmitter() {
  const listeners = new Set<() => void>()
  return {
    emit() {
      listeners.forEach((listener) => listener())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function toVector3(point: Vec3) {
  return new Vector3(point.x, point.y, point.z)
}

function cloneVec3(point: Vector3): Vec3 {
  return { x: point.x, y: point.y, z: point.z }
}

function frameToWorld(frame: AnnotationFrame, localPoint: Vec2): Vec3 {
  return {
    x: frame.origin.x + frame.xAxis.x * localPoint.x + frame.yAxis.x * localPoint.y,
    y: frame.origin.y + frame.xAxis.y * localPoint.x + frame.yAxis.y * localPoint.y,
    z: frame.origin.z + frame.xAxis.z * localPoint.x + frame.yAxis.z * localPoint.y,
  }
}

function worldToFrame(frame: AnnotationFrame, worldPoint: Vec3): Vec2 {
  const dx = worldPoint.x - frame.origin.x
  const dy = worldPoint.y - frame.origin.y
  const dz = worldPoint.z - frame.origin.z
  return {
    x: dx * frame.xAxis.x + dy * frame.xAxis.y + dz * frame.xAxis.z,
    y: dx * frame.yAxis.x + dy * frame.yAxis.y + dz * frame.yAxis.z,
  }
}

/**
 * A self-contained Three.js viewer that loads a single GLB/glTF model and lets
 * users anchor surface-aligned 2D annotations onto it. The shared annotation
 * overlay, collaboration room, and rendering all live above the ViewerAdapter
 * seam — this adapter only owns the 3D scene, camera, and coordinate transforms.
 *
 * Ported from /development/collaboration's threeSceneAdapter with the demo-only
 * streaming/LOD/worker/manifest machinery removed (it was scaffolding for a
 * procedural multi-asset scene and a no-op for real GLB models).
 */
export function createThreeModelViewerAdapter(options: ThreeModelViewerOptions): ViewerAdapter {
  const { src, targetId } = options
  const emitter = createEmitter()

  const gltfLoader = new GLTFLoader()
  const dracoLoader = new DRACOLoader()
  const ktx2Loader = new KTX2Loader()

  let renderer: WebGLRenderer | null = null
  let camera: PerspectiveCamera | null = null
  let scene: Scene | null = null
  let modelRoot: Group | null = null
  let environmentMap: Texture | null = null
  let hostElement: HTMLElement | null = null
  let viewport: ViewportSize = { width: 0, height: 0 }
  let navigationMode: NavigationMode | null = null
  let renderMode: SceneRenderMode = 'shaded'
  let loadStatus: 'pending' | 'loading' | 'ready' | 'error' = 'pending'
  let pendingFrame: AnnotationFrame | null = null

  // Camera-distance bounds are derived from the loaded model's size.
  let minRadius = 0.1
  let maxRadius = 1000

  const viewState: ViewState = {
    radius: 8,
    theta: Math.PI / 4,
    phi: Math.PI / 3,
    target: new Vector3(0, 0, 0),
  }

  const pickables = new Set<Mesh>()
  const raycaster = new Raycaster()
  const groundPlane = new Plane(new Vector3(0, 1, 0), 0)
  const framePlane = new Plane()
  const scratchPointer = new Vector2()
  const scratchVector = new Vector3()
  const scratchVectorB = new Vector3()
  const scratchVectorC = new Vector3()
  const scratchVectorD = new Vector3()

  function captureCameraView() {
    const position = camera?.position ?? scratchVector.set(
      viewState.target.x + viewState.radius * Math.sin(viewState.phi) * Math.cos(viewState.theta),
      viewState.target.y + viewState.radius * Math.cos(viewState.phi),
      viewState.target.z + viewState.radius * Math.sin(viewState.phi) * Math.sin(viewState.theta),
    )
    return {
      position: cloneVec3(position),
      target: cloneVec3(viewState.target),
      radius: viewState.radius,
      theta: viewState.theta,
      phi: viewState.phi,
    }
  }

  function withCapturedCamera(frame: AnnotationFrame): AnnotationFrame {
    return { ...frame, cameraView: captureCameraView() }
  }

  function applyCameraView(frame: AnnotationFrame) {
    const view = frame.cameraView
    if (!view) {
      return
    }
    viewState.radius = clamp(view.radius, minRadius, maxRadius)
    viewState.theta = view.theta
    viewState.phi = clamp(view.phi, PHI_EPSILON, Math.PI - PHI_EPSILON)
    viewState.target.set(view.target.x, view.target.y, view.target.z)
    renderScene()
  }

  function syncCamera() {
    if (!camera) {
      return
    }
    const sinPhi = Math.sin(viewState.phi)
    camera.position.set(
      viewState.target.x + viewState.radius * sinPhi * Math.cos(viewState.theta),
      viewState.target.y + viewState.radius * Math.cos(viewState.phi),
      viewState.target.z + viewState.radius * sinPhi * Math.sin(viewState.theta),
    )
    camera.up.set(0, 1, 0)
    camera.lookAt(viewState.target)
    camera.updateMatrixWorld()
  }

  function renderScene(emit = true) {
    if (!renderer || !scene || !camera) {
      return
    }
    syncCamera()
    renderer.render(scene, camera)
    if (emit) {
      emitter.emit()
    }
  }

  function configureLoaders(activeRenderer: WebGLRenderer) {
    dracoLoader.setDecoderConfig({ type: 'wasm' })
    dracoLoader.setDecoderPath('/decoders/draco/gltf/')
    gltfLoader.setDRACOLoader(dracoLoader)
    gltfLoader.setMeshoptDecoder(MeshoptDecoder)
    ktx2Loader.setTranscoderPath('/transcoders/basis/')
    ktx2Loader.detectSupport(activeRenderer)
    gltfLoader.setKTX2Loader(ktx2Loader)
  }

  function registerPickables(root: Object3D) {
    root.traverse((object) => {
      if (object instanceof Mesh) {
        pickables.add(object)
      }
    })
  }

  /** Center the model on the ground (min.y = 0) without rescaling source units. */
  function placeModel(root: Object3D) {
    root.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(root)
    if (bounds.isEmpty()) {
      return
    }
    const center = bounds.getCenter(new Vector3())
    root.position.set(-center.x, -bounds.min.y, -center.z)
    root.updateMatrixWorld(true)
  }

  /** Frame the camera to fit the whole model in view. */
  function frameModel() {
    if (!scene || !modelRoot) {
      return
    }
    const bounds = new Box3().setFromObject(modelRoot)
    if (bounds.isEmpty()) {
      return
    }
    const sphere = bounds.getBoundingSphere(new Sphere())
    const fov = (camera?.fov ?? DEFAULT_FOV) * (Math.PI / 180)
    const fitRadius = sphere.radius / Math.sin(fov / 2)
    minRadius = Math.max(sphere.radius * 0.02, 0.01)
    maxRadius = fitRadius * 8
    viewState.target.copy(sphere.center)
    viewState.radius = clamp(fitRadius * 1.3, minRadius, maxRadius)
    renderScene()
  }

  function ensureRay(screenPoint: Vec2) {
    if (!camera || viewport.width <= 0 || viewport.height <= 0) {
      return false
    }
    scratchPointer.set(
      (screenPoint.x / viewport.width) * 2 - 1,
      -(screenPoint.y / viewport.height) * 2 + 1,
    )
    raycaster.setFromCamera(scratchPointer, camera)
    return true
  }

  /** Build a tangent frame on the picked surface so 2D markup lies flat against it. */
  function createFrameFromSurfaceHit(hitPoint: Vector3, hitNormal?: Vector3): AnnotationFrame {
    const normal = (hitNormal ? scratchVector.copy(hitNormal) : scratchVector.set(0, 1, 0)).normalize()
    const reference = Math.abs(normal.y) < 0.9 ? scratchVectorB.set(0, 1, 0) : scratchVectorB.set(1, 0, 0)
    const xAxis = scratchVectorC.copy(reference).cross(normal).normalize()
    if (xAxis.lengthSq() < 1e-6) {
      xAxis.set(1, 0, 0)
    }
    const yAxis = scratchVectorD.copy(normal).cross(xAxis).normalize()
    return withCapturedCamera({
      space: 'world3d',
      origin: { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
      xAxis: { x: xAxis.x, y: xAxis.y, z: xAxis.z },
      yAxis: { x: yAxis.x, y: yAxis.y, z: yAxis.z },
      targetId,
    })
  }

  function resolveSurfacePoint(screenPoint: Vec2) {
    if (!ensureRay(screenPoint)) {
      return null
    }
    const hit = raycaster.intersectObjects(Array.from(pickables), false)[0]
    if (hit) {
      const worldNormal = hit.face?.normal
        ? scratchVectorB.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize()
        : undefined
      return {
        worldPoint: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
        frame: createFrameFromSurfaceHit(hit.point, worldNormal),
      }
    }
    const planeHit = raycaster.ray.intersectPlane(groundPlane, scratchVector)
    if (!planeHit) {
      return null
    }
    return {
      worldPoint: { x: planeHit.x, y: planeHit.y, z: planeHit.z },
      frame: createFrameFromSurfaceHit(planeHit, scratchVectorB.set(0, 1, 0)),
    }
  }

  function intersectFramePlane(screenPoint: Vec2, frame: AnnotationFrame) {
    if (!ensureRay(screenPoint)) {
      return null
    }
    const origin = toVector3(frame.origin)
    const xAxis = toVector3(frame.xAxis)
    const yAxis = toVector3(frame.yAxis)
    const normal = scratchVectorC.copy(xAxis).cross(yAxis).normalize()
    if (!Number.isFinite(normal.x) || !Number.isFinite(normal.y) || !Number.isFinite(normal.z)) {
      return null
    }
    framePlane.setFromNormalAndCoplanarPoint(normal, origin)
    const hit = raycaster.ray.intersectPlane(framePlane, scratchVector)
    return hit ? { x: hit.x, y: hit.y, z: hit.z } : null
  }

  function applyRenderMode() {
    const wireframe = renderMode === 'wireframe'
    modelRoot?.traverse((object) => {
      if (!(object instanceof Mesh)) {
        return
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        if (material instanceof MeshStandardMaterial) {
          material.wireframe = wireframe
          material.needsUpdate = true
        }
      })
    })
  }

  function setRenderMode(next: SceneRenderMode) {
    if (renderMode === next) {
      return
    }
    renderMode = next
    applyRenderMode()
    renderScene()
  }

  function loadModel() {
    loadStatus = 'loading'
    emitter.emit()
    gltfLoader.load(
      src,
      (gltf) => {
        if (!scene) {
          return
        }
        const root = new Group()
        root.add(gltf.scene)
        placeModel(root)
        registerPickables(root)
        scene.add(root)
        modelRoot = root
        loadStatus = 'ready'
        frameModel()
      },
      undefined,
      () => {
        loadStatus = 'error'
        renderScene()
      },
    )
  }

  function resize(nextViewport: ViewportSize) {
    viewport = nextViewport
    if (!renderer || !camera || viewport.width <= 0 || viewport.height <= 0) {
      return
    }
    renderer.setPixelRatio(window.devicePixelRatio || 1)
    renderer.setSize(viewport.width, viewport.height, false)
    camera.aspect = viewport.width / viewport.height
    camera.updateProjectionMatrix()
    renderScene()
  }

  const actions: ViewerAction[] = [
    { id: 'frame-model', label: 'Frame model', onSelect: () => frameModel() },
    { id: 'render-mode-shaded', label: 'Shaded', onSelect: () => setRenderMode('shaded') },
    { id: 'render-mode-wireframe', label: 'Wireframe', onSelect: () => setRenderMode('wireframe') },
  ]

  const adapter: ViewerAdapter = {
    id: 'three-model-viewer',
    name: '3D model viewer',
    description: 'Perspective Three.js model viewer with surface-anchored annotation.',
    space: 'world3d',
    targetId,
    createFrame(origin) {
      if (pendingFrame) {
        const frame = pendingFrame
        pendingFrame = null
        return frame
      }
      return withCapturedCamera({
        space: 'world3d',
        origin,
        xAxis: { x: 1, y: 0, z: 0 },
        yAxis: { x: 0, y: 1, z: 0 },
        targetId,
      })
    },
    worldToScreen(worldPoint, nextViewport) {
      if (!camera || nextViewport.width <= 0 || nextViewport.height <= 0) {
        return null
      }
      const projected = toVector3(worldPoint).project(camera)
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.z < -1 || projected.z > 1) {
        return null
      }
      return {
        x: (projected.x * 0.5 + 0.5) * nextViewport.width,
        y: (-projected.y * 0.5 + 0.5) * nextViewport.height,
      }
    },
    screenToWorld(screenPoint) {
      const resolved = resolveSurfacePoint(screenPoint)
      if (!resolved) {
        return null
      }
      // Stash the surface-oriented frame so createFrame() can return it with the
      // correct tangent basis and camera snapshot for the same gesture.
      pendingFrame = resolved.frame
      return resolved.worldPoint
    },
    project(frame, localPoint, nextViewport) {
      return adapter.worldToScreen(frameToWorld(frame, localPoint), nextViewport)
    },
    screenToFrameLocal(screenPoint, frame) {
      const worldPoint = intersectFramePlane(screenPoint, frame) ?? adapter.screenToWorld(screenPoint, viewport)
      return worldPoint ? worldToFrame(frame, worldPoint) : null
    },
    getProjectionRevision() {
      // Annotation projection depends on the live camera orbit and target.
      return [
        viewState.radius,
        viewState.theta,
        viewState.phi,
        viewState.target.x,
        viewState.target.y,
        viewState.target.z,
      ].join('|')
    },
    renderBackdrop() {},
    formatAnchor(frame) {
      return `world(${frame.origin.x.toFixed(2)}, ${frame.origin.y.toFixed(2)}, ${frame.origin.z.toFixed(2)})`
    },
    onSelectionChange(annotation) {
      if (!annotation || annotation.frame.space !== 'world3d' || annotation.frame.targetId !== targetId) {
        return
      }
      applyCameraView(annotation.frame)
    },
    mountSurface(host): ViewerSurfaceController {
      hostElement = host
      host.replaceChildren()

      renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
      renderer.outputColorSpace = SRGBColorSpace
      renderer.toneMapping = ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.1
      renderer.setClearColor('#0b1020')
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      renderer.domElement.style.display = 'block'
      host.appendChild(renderer.domElement)
      configureLoaders(renderer)

      camera = new PerspectiveCamera(DEFAULT_FOV, 1, 0.01, 10000)
      camera.up.set(0, 1, 0)

      scene = new Scene()

      // Neutral image-based lighting from RoomEnvironment — gives PBR materials
      // proper reflections without shipping an external HDR file.
      const pmrem = new PMREMGenerator(renderer)
      environmentMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      scene.environment = environmentMap
      pmrem.dispose()

      const hemisphere = new HemisphereLight(0xffffff, 0x404050, 1.1)
      scene.add(hemisphere)
      const key = new DirectionalLight(0xffffff, 1.6)
      key.position.set(4, 8, 6)
      scene.add(key)
      scene.add(new AmbientLight(0xffffff, 0.25))

      const grid = new GridHelper(20, 20, 0x3a4a6a, 0x1c2740)
      grid.material.transparent = true
      grid.material.opacity = 0.35
      scene.add(grid)

      if (viewport.width > 0 && viewport.height > 0) {
        resize(viewport)
      }
      loadModel()
      renderScene(false)

      return {
        resize,
        dispose() {
          ktx2Loader.dispose()
          dracoLoader.dispose()
          pickables.clear()
          if (modelRoot) {
            modelRoot.traverse((object) => {
              if (object instanceof Mesh) {
                object.geometry.dispose()
                const materials = Array.isArray(object.material) ? object.material : [object.material]
                materials.forEach((material) => material.dispose())
              }
            })
            scene?.remove(modelRoot)
            modelRoot = null
          }
          environmentMap?.dispose()
          environmentMap = null
          renderer?.dispose()
          hostElement?.replaceChildren()
          renderer = null
          camera = null
          scene = null
          hostElement = null
          loadStatus = 'pending'
        },
      }
    },
    subscribe(listener) {
      return emitter.subscribe(listener)
    },
    getActions() {
      return actions.map((action) => ({
        ...action,
        active:
          (action.id === 'render-mode-shaded' && renderMode === 'shaded')
          || (action.id === 'render-mode-wireframe' && renderMode === 'wireframe'),
      }))
    },
    getStatusBadges() {
      const statusLabel: Record<typeof loadStatus, string> = {
        pending: 'Idle',
        loading: 'Loading…',
        ready: 'Loaded',
        error: 'Load failed',
      }
      return [
        `Model ${statusLabel[loadStatus]}`,
        `Render ${renderMode === 'wireframe' ? 'Wireframe' : 'Shaded'}`,
      ]
    },
    selectSceneObjectAt() {
      return false
    },
    handleWheel(_screenPoint, deltaY) {
      viewState.radius = clamp(viewState.radius * Math.exp(deltaY * 0.001), minRadius, maxRadius)
      renderScene()
      return true
    },
    beginNavigation(_screenPoint, navOptions: NavigationOptions) {
      if (navOptions.button === 1 || navOptions.shiftKey) {
        navigationMode = 'pan'
        return true
      }
      if (navOptions.button === 2 || navOptions.altKey || navOptions.metaKey || navOptions.ctrlKey) {
        navigationMode = 'orbit'
        return true
      }
      return false
    },
    updateNavigation(_screenPoint, delta, nextViewport) {
      if (!camera) {
        return
      }
      if (navigationMode === 'orbit') {
        viewState.theta -= delta.x * 0.008
        viewState.phi = clamp(viewState.phi - delta.y * 0.008, PHI_EPSILON, Math.PI - PHI_EPSILON)
        renderScene()
        return
      }
      if (navigationMode === 'pan') {
        const panScale = (viewState.radius / Math.max(nextViewport.width, nextViewport.height, 1)) * 2
        camera.getWorldDirection(scratchVector).normalize()
        const right = scratchVectorB.copy(scratchVector).cross(camera.up).normalize()
        const up = scratchVectorC.copy(camera.up).normalize()
        viewState.target
          .addScaledVector(right, -delta.x * panScale)
          .addScaledVector(up, delta.y * panScale)
        renderScene()
      }
    },
    endNavigation() {
      navigationMode = null
    },
  }

  return adapter
}
