import type { AnnotationFrame, Vec2, Vec3 } from '../annotations/types'
import type {
  ViewerAction,
  ViewerAdapter,
  ViewerDiagnosticItem,
  ViewerSurfaceController,
  ViewportSize,
} from './adapters'

interface ViewState {
  scale: number
  offsetX: number
  offsetY: number
  initialized: boolean
}

export interface VideoSourceOption {
  id?: string
  src: string
  type?: string
  label?: string
}

export interface VideoPlaylistClipState {
  id: string
  label: string
  duration: number
  startTime: number
  endTime: number
  width: number
  height: number
  error?: string
}

export interface VideoMediaState {
  ready: boolean
  playing: boolean
  duration: number
  currentTime: number
  playlistDuration: number
  playlistCurrentTime: number
  frameRate: number
  playbackRate: number
  muted: boolean
  volume: number
  width: number
  height: number
  currentFrame: number
  activeClipIndex: number
  activeClipId?: string
  sourceLabel: string
  sourceCount: number
  playlist: VideoPlaylistClipState[]
  error?: string
}

export interface VideoViewerAdapter extends ViewerAdapter {
  targetId: string
  getMediaState: () => VideoMediaState
  togglePlayback: () => void
  pausePlayback: () => void
  seekToProgress: (progress: number) => void
  beginScrubbing: () => void
  previewSeekToProgress: (progress: number) => void
  endScrubbing: (progress: number) => void
  stepFrames: (delta: number) => void
  setPlaybackRate: (rate: number) => void
  setFrameRate: (rate: number) => void
  setMuted: (muted: boolean) => void
  setVolume: (volume: number) => void
  loadSources: (sources: VideoSourceOption[]) => void
  loadFiles: (files: FileList | File[]) => void
}

interface PlaylistClipInternal extends VideoPlaylistClipState {
  src: string
  type?: string
}

const DEFAULT_WIDTH = 1920
const DEFAULT_HEIGHT = 1080
const MIN_SCALE = 0.1
const MAX_SCALE = 8
const PADDING = 24
const TARGET_ID = 'frame-accurate-video'

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

// The frame index a time falls in. floor (not round) so a time anywhere within
// frame N — including its mid-point (N+0.5)/fps — reports N. The tiny epsilon
// absorbs floating-point error at exact frame boundaries.
function timeToFrame(time: number, frameRate: number) {
  const fps = Math.max(frameRate, 1)
  return Math.max(0, Math.floor(time * fps + 1e-6))
}

// The timestamp at the centre of a frame. Seeking here lands inside the intended
// frame for constant-frame-rate sources, which `fastSeek` (keyframe snapping)
// cannot guarantee. This is the core of frame-accurate seeking.
function frameToMidTime(frame: number, frameRate: number) {
  const fps = Math.max(frameRate, 1)
  return (Math.max(0, frame) + 0.5) / fps
}

// Snap a continuous time to its frame centre. Idempotent: because timeToFrame
// floors, re-snapping an already-centred time returns the same value, so routing
// a mid-frame seek through here can't drift the frame (the round-based bug).
function snapTimeToFrame(time: number, frameRate: number) {
  return frameToMidTime(timeToFrame(time, frameRate), frameRate)
}

function extensionToMimeType(name: string) {
  const lower = name.toLowerCase()
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) {
    return 'video/mp4'
  }
  if (lower.endsWith('.webm')) {
    return 'video/webm'
  }
  if (lower.endsWith('.ogv') || lower.endsWith('.ogg')) {
    return 'video/ogg'
  }
  if (lower.endsWith('.mov')) {
    return 'video/quicktime'
  }
  return undefined
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

function toPlaylistClip(source: VideoSourceOption, index: number): PlaylistClipInternal {
  return {
    id: source.id ?? `${index}:${source.label ?? source.src}`,
    src: source.src,
    type: source.type,
    label: source.label ?? `Clip ${index + 1}`,
    duration: 0,
    startTime: 0,
    endTime: 0,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    error: undefined,
  }
}

function recomputeClipRanges(clips: PlaylistClipInternal[]) {
  let cursor = 0
  clips.forEach((clip) => {
    clip.startTime = cursor
    clip.endTime = cursor + Math.max(clip.duration, 0)
    cursor = clip.endTime
  })
}

function clonePlaylistState(clips: PlaylistClipInternal[]): VideoPlaylistClipState[] {
  return clips.map((clip) => ({
    id: clip.id,
    label: clip.label,
    duration: clip.duration,
    startTime: clip.startTime,
    endTime: clip.endTime,
    width: clip.width,
    height: clip.height,
    error: clip.error,
  }))
}

function getPlaylistDuration(clips: PlaylistClipInternal[]) {
  return clips.length > 0 ? clips[clips.length - 1].endTime : 0
}

function waitForEvent(target: HTMLVideoElement, eventName: string, errorNames: string[] = ['error']) {
  return new Promise<void>((resolve, reject) => {
    const onResolve = () => {
      cleanup()
      resolve()
    }
    const onReject = () => {
      cleanup()
      reject(target.error ?? new Error('Video element error'))
    }
    const cleanup = () => {
      target.removeEventListener(eventName, onResolve)
      errorNames.forEach((name) => target.removeEventListener(name, onReject))
    }

    target.addEventListener(eventName, onResolve, { once: true })
    errorNames.forEach((name) => target.addEventListener(name, onReject, { once: true }))
  })
}

async function seekVideo(video: HTMLVideoElement, time: number, frameRate: number) {
  const duration = Number.isFinite(video.duration) ? video.duration : time
  const nextTime = clamp(snapTimeToFrame(time, frameRate), 0, duration)
  if (Math.abs(video.currentTime - nextTime) < 1e-4) {
    return
  }

  // Frame-accurate seeking needs an exact currentTime assignment; fastSeek snaps
  // to the nearest keyframe and is deliberately avoided here.
  video.currentTime = nextTime
  await waitForEvent(video, 'seeked')
}

async function measureClipMetadata(clip: PlaylistClipInternal) {
  const probe = document.createElement('video')
  probe.preload = 'metadata'
  probe.muted = true
  probe.playsInline = true
  probe.crossOrigin = 'anonymous'
  probe.src = clip.src

  try {
    if (probe.readyState < 1) {
      probe.load()
      await waitForEvent(probe, 'loadedmetadata')
    }
    return {
      duration: Number.isFinite(probe.duration) ? probe.duration : 0,
      width: Math.max(probe.videoWidth || clip.width, 1),
      height: Math.max(probe.videoHeight || clip.height, 1),
      error: undefined,
    }
  } catch {
    return {
      duration: clip.duration,
      width: clip.width,
      height: clip.height,
      error: probe.error?.message || 'Unable to read clip metadata',
    }
  } finally {
    probe.pause()
    probe.removeAttribute('src')
    probe.load()
  }
}

export interface VideoViewerAdapterOptions {
  /** Sheet id annotations are bound to (frame.targetId). Defaults to TARGET_ID.
   *  Pass a per-asset id so annotations on different videos don't collide. */
  targetId?: string
  /** Initial playback frame rate, ideally the exact ffprobe value for the source.
   *  Frame-accurate seeking depends on this; falls back to 24fps. */
  frameRate?: number
}

export function createVideoViewerAdapter(
  initialSources: VideoSourceOption[] = [],
  options: VideoViewerAdapterOptions = {},
): VideoViewerAdapter {
  const resolvedTargetId = options.targetId ?? TARGET_ID
  const emitter = createEmitter()
  const view: ViewState = {
    scale: 0.25,
    offsetX: 0,
    offsetY: 0,
    initialized: false,
  }

  let playlist = initialSources.map(toPlaylistClip)
  recomputeClipRanges(playlist)

  const mediaState: VideoMediaState = {
    ready: false,
    playing: false,
    duration: 0,
    currentTime: 0,
    playlistDuration: getPlaylistDuration(playlist),
    playlistCurrentTime: 0,
    frameRate: options.frameRate && options.frameRate > 0 ? options.frameRate : 24,
    playbackRate: 1,
    muted: false,
    volume: 1,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    currentFrame: 0,
    activeClipIndex: playlist.length > 0 ? 0 : -1,
    activeClipId: playlist[0]?.id,
    sourceLabel: playlist[0]?.label ?? 'No media loaded',
    sourceCount: playlist.length,
    playlist: clonePlaylistState(playlist),
  }

  let viewport: ViewportSize = { width: 0, height: 0 }
  let videoElements: [HTMLVideoElement | null, HTMLVideoElement | null] = [null, null]
  let activeDeckIndex = 0
  let deckClipIndices: [number | null, number | null] = [null, null]
  const deckLoadTokens: [number, number] = [0, 0]
  let objectUrls: string[] = []
  let frameCallbackHandle = 0
  let pendingSeek = false
  let scrubAnimationFrame = 0
  let pendingScrubGlobalTime: number | null = null
  let wasPlayingBeforeScrub = false
  let scrubbing = false
  let metadataRevision = 0
  let cachedMediaStateSnapshot: VideoMediaState | null = null
  let cachedMediaStateSnapshotKey = ''

  function getActiveVideo() {
    return videoElements[activeDeckIndex]
  }

  function getStandbyVideo() {
    return videoElements[1 - activeDeckIndex]
  }

  function syncPlaylistState() {
    recomputeClipRanges(playlist)
    mediaState.sourceCount = playlist.length
    mediaState.playlist = clonePlaylistState(playlist)
    mediaState.playlistDuration = getPlaylistDuration(playlist)
  }

  function createMediaStateSnapshotKey() {
    return [
      metadataRevision,
      mediaState.ready,
      mediaState.playing,
      mediaState.duration,
      mediaState.currentTime,
      mediaState.playlistDuration,
      mediaState.playlistCurrentTime,
      mediaState.frameRate,
      mediaState.playbackRate,
      mediaState.muted,
      mediaState.volume,
      mediaState.width,
      mediaState.height,
      mediaState.currentFrame,
      mediaState.activeClipIndex,
      mediaState.activeClipId ?? '',
      mediaState.sourceLabel,
      mediaState.sourceCount,
      mediaState.error ?? '',
    ].join('|')
  }

  function getMediaStateSnapshot() {
    const snapshotKey = createMediaStateSnapshotKey()
    if (cachedMediaStateSnapshot && cachedMediaStateSnapshotKey === snapshotKey) {
      return cachedMediaStateSnapshot
    }

    cachedMediaStateSnapshotKey = snapshotKey
    cachedMediaStateSnapshot = {
      ...mediaState,
      playlist: mediaState.playlist.map((clip) => ({ ...clip })),
    }

    return cachedMediaStateSnapshot
  }

  function syncVideoPresentation() {
    videoElements.forEach((video, index) => {
      if (!video) {
        return
      }

      video.style.opacity = index === activeDeckIndex ? '1' : '0'
      video.style.zIndex = index === activeDeckIndex ? '2' : '1'
      video.style.visibility = deckClipIndices[index] === null ? 'hidden' : 'visible'
      video.muted = mediaState.muted
      video.volume = mediaState.volume
      video.playbackRate = mediaState.playbackRate
    })
  }

  function resetVideoElement(video: HTMLVideoElement | null) {
    if (!video) {
      return
    }

    video.pause()
    video.removeAttribute('src')
    video.load()
  }

  function resolvePlaylistTime(globalTime: number) {
    if (playlist.length === 0) {
      return { clipIndex: -1, clipTime: 0, globalTime: 0 }
    }

    const totalDuration = getPlaylistDuration(playlist)
    if (totalDuration <= 0) {
      return { clipIndex: 0, clipTime: 0, globalTime: 0 }
    }

    const clampedTime = clamp(globalTime, 0, totalDuration)
    const clipIndex = playlist.findIndex(
      (clip, index) => clampedTime <= clip.endTime || index === playlist.length - 1,
    )
    const safeClipIndex = clipIndex >= 0 ? clipIndex : playlist.length - 1
    const clip = playlist[safeClipIndex]

    return {
      clipIndex: safeClipIndex,
      clipTime: clamp(clampedTime - clip.startTime, 0, Math.max(clip.duration, 0)),
      globalTime: clampedTime,
    }
  }

  function applyActiveClipState(activeVideo = getActiveVideo()) {
    const clipIndex = mediaState.activeClipIndex
    const clip = clipIndex >= 0 ? playlist[clipIndex] : undefined
    if (!clip) {
      mediaState.ready = false
      mediaState.playing = false
      mediaState.duration = 0
      mediaState.currentTime = 0
      mediaState.playlistCurrentTime = 0
      mediaState.currentFrame = 0
      mediaState.activeClipId = undefined
      mediaState.sourceLabel = 'No media loaded'
      mediaState.width = DEFAULT_WIDTH
      mediaState.height = DEFAULT_HEIGHT
      return
    }

    mediaState.activeClipId = clip.id
    mediaState.sourceLabel = clip.label
    mediaState.duration = clip.duration
    mediaState.width = Math.max(activeVideo?.videoWidth || clip.width, 1)
    mediaState.height = Math.max(activeVideo?.videoHeight || clip.height, 1)
    mediaState.currentTime = activeVideo ? activeVideo.currentTime || 0 : 0
    mediaState.playlistCurrentTime = clip.startTime + mediaState.currentTime
    mediaState.currentFrame = timeToFrame(mediaState.currentTime, mediaState.frameRate)
  }

  function getVideoDimensions() {
    return {
      width: Math.max(getActiveVideo()?.videoWidth || mediaState.width, 1),
      height: Math.max(getActiveVideo()?.videoHeight || mediaState.height, 1),
    }
  }

  function fitToViewport(nextViewport: ViewportSize) {
    const { width, height } = getVideoDimensions()
    if (nextViewport.width <= 0 || nextViewport.height <= 0) {
      return
    }
    view.scale = Math.min(
      (nextViewport.width - PADDING * 2) / width,
      (nextViewport.height - PADDING * 2) / height,
    )
    view.offsetX = (nextViewport.width - width * view.scale) / 2
    view.offsetY = (nextViewport.height - height * view.scale) / 2
    view.initialized = true
    applyVideoLayout()
    emitter.emit()
  }

  function ensureInitialized(nextViewport: ViewportSize) {
    if (!view.initialized && nextViewport.width > 0 && nextViewport.height > 0) {
      fitToViewport(nextViewport)
    }
  }

  function clampOffsets(nextViewport: ViewportSize) {
    const { width, height } = getVideoDimensions()
    const scaledWidth = width * view.scale
    const scaledHeight = height * view.scale
    const minOffsetX = Math.min(PADDING, nextViewport.width - scaledWidth - PADDING)
    const maxOffsetX = Math.max(PADDING, nextViewport.width - scaledWidth - PADDING)
    const minOffsetY = Math.min(PADDING, nextViewport.height - scaledHeight - PADDING)
    const maxOffsetY = Math.max(PADDING, nextViewport.height - scaledHeight - PADDING)
    view.offsetX = clamp(view.offsetX, minOffsetX, maxOffsetX)
    view.offsetY = clamp(view.offsetY, minOffsetY, maxOffsetY)
  }

  function applyVideoLayout() {
    if (viewport.width <= 0 || viewport.height <= 0) {
      return
    }

    const { width, height } = getVideoDimensions()
    videoElements.forEach((video) => {
      if (!video) {
        return
      }
      video.style.width = `${width * view.scale}px`
      video.style.height = `${height * view.scale}px`
      video.style.left = `${view.offsetX}px`
      video.style.top = `${view.offsetY}px`
    })
  }

  function rawWorldToScreen(worldPoint: Vec3, nextViewport: ViewportSize) {
    ensureInitialized(nextViewport)
    return {
      x: view.offsetX + worldPoint.x * view.scale,
      y: view.offsetY + worldPoint.y * view.scale,
    }
  }

  function rawScreenToWorld(screenPoint: Vec2, nextViewport: ViewportSize): Vec3 {
    ensureInitialized(nextViewport)
    return {
      x: (screenPoint.x - view.offsetX) / view.scale,
      y: (screenPoint.y - view.offsetY) / view.scale,
      z: 0,
    }
  }

  function updateFrameState(video = getActiveVideo()) {
    const activeVideo = getActiveVideo()
    if (!video || !activeVideo || video !== activeVideo) {
      return
    }

    const clip = mediaState.activeClipIndex >= 0 ? playlist[mediaState.activeClipIndex] : undefined
    if (clip) {
      clip.duration = Number.isFinite(activeVideo.duration) ? activeVideo.duration : clip.duration
      clip.width = Math.max(activeVideo.videoWidth || clip.width, 1)
      clip.height = Math.max(activeVideo.videoHeight || clip.height, 1)
      clip.error = undefined
      syncPlaylistState()
    }

    mediaState.ready = activeVideo.readyState >= 1
    mediaState.playing = !activeVideo.paused && !activeVideo.ended
    mediaState.playbackRate = activeVideo.playbackRate
    mediaState.volume = activeVideo.volume
    mediaState.muted = activeVideo.muted
    applyActiveClipState(activeVideo)
    emitter.emit()
  }

  function cancelFrameLoop() {
    const activeVideo = getActiveVideo()
    if (activeVideo && frameCallbackHandle && 'cancelVideoFrameCallback' in activeVideo) {
      ;(activeVideo as HTMLVideoElement & { cancelVideoFrameCallback(id: number): void }).cancelVideoFrameCallback(frameCallbackHandle)
    }
    frameCallbackHandle = 0
  }

  function cancelScrubFrame() {
    if (scrubAnimationFrame) {
      window.cancelAnimationFrame(scrubAnimationFrame)
      scrubAnimationFrame = 0
    }
  }

  function scheduleFrameLoop() {
    const activeVideo = getActiveVideo()
    if (!activeVideo || !('requestVideoFrameCallback' in activeVideo)) {
      return
    }
    cancelFrameLoop()
    const nextFrame = () => {
      const currentVideo = getActiveVideo()
      if (!currentVideo) {
        return
      }
      frameCallbackHandle = (currentVideo as HTMLVideoElement & {
        requestVideoFrameCallback(callback: () => void): number
      }).requestVideoFrameCallback(() => {
        updateFrameState(currentVideo)
        if (currentVideo === getActiveVideo() && !currentVideo.paused) {
          nextFrame()
        }
      })
    }
    nextFrame()
  }

  function clearSources() {
    cancelFrameLoop()
    cancelScrubFrame()
    metadataRevision += 1
    objectUrls.forEach((url) => URL.revokeObjectURL(url))
    objectUrls = []
  }

  async function refreshPlaylistMetadata() {
    const revision = ++metadataRevision
    const results = await Promise.all(playlist.map((clip) => measureClipMetadata(clip)))
    if (revision !== metadataRevision) {
      return
    }

    results.forEach((result, index) => {
      const clip = playlist[index]
      if (!clip) {
        return
      }
      clip.duration = result.duration
      clip.width = result.width
      clip.height = result.height
      clip.error = result.error
    })

    syncPlaylistState()
    applyActiveClipState()
    emitter.emit()
  }

  async function prepareDeck(deckIndex: number, clipIndex: number, clipTime = 0) {
    const video = videoElements[deckIndex]
    const clip = playlist[clipIndex]
    if (!video || !clip) {
      deckClipIndices[deckIndex] = null
      return false
    }

    const token = deckLoadTokens[deckIndex] + 1
    deckLoadTokens[deckIndex] = token
    deckClipIndices[deckIndex] = clipIndex

    video.pause()
    video.src = clip.src
    video.load()

    try {
      if (video.readyState < 1) {
        await waitForEvent(video, 'loadedmetadata')
      }
      if (deckLoadTokens[deckIndex] !== token) {
        return false
      }

      clip.duration = Number.isFinite(video.duration) ? video.duration : clip.duration
      clip.width = Math.max(video.videoWidth || clip.width, 1)
      clip.height = Math.max(video.videoHeight || clip.height, 1)
      clip.error = undefined
      syncPlaylistState()

      if (clipTime > 0) {
        pendingSeek = true
        await seekVideo(video, clipTime, mediaState.frameRate)
        if (deckLoadTokens[deckIndex] !== token) {
          return false
        }
      }

      return true
    } catch {
      if (deckLoadTokens[deckIndex] === token) {
        clip.error = video.error?.message || 'Unable to load clip'
        syncPlaylistState()
        if (deckIndex === activeDeckIndex) {
          mediaState.ready = false
          mediaState.playing = false
          mediaState.error = clip.error
          emitter.emit()
        }
      }
      return false
    }
  }

  async function primeStandbyDeck(clipIndex: number) {
    const standbyDeckIndex = 1 - activeDeckIndex
    if (clipIndex < 0 || clipIndex >= playlist.length) {
      deckClipIndices[standbyDeckIndex] = null
      resetVideoElement(videoElements[standbyDeckIndex])
      syncVideoPresentation()
      return
    }

    if (deckClipIndices[standbyDeckIndex] === clipIndex) {
      syncVideoPresentation()
      return
    }

    await prepareDeck(standbyDeckIndex, clipIndex, 0)
    syncVideoPresentation()
  }

  async function activateClip(clipIndex: number, clipTime = 0, autoplay = false) {
    const video = getActiveVideo()
    const clip = playlist[clipIndex]
    if (!video || !clip) {
      return
    }

    cancelFrameLoop()
    mediaState.activeClipIndex = clipIndex
    mediaState.activeClipId = clip.id
    mediaState.sourceLabel = clip.label
    mediaState.duration = clip.duration
    mediaState.currentTime = clipTime
    mediaState.playlistCurrentTime = clip.startTime + clipTime
    mediaState.currentFrame = timeToFrame(clipTime, mediaState.frameRate)
    mediaState.width = clip.width
    mediaState.height = clip.height
    mediaState.ready = false
    mediaState.playing = false
    mediaState.error = clip.error
    emitter.emit()

    const loaded = await prepareDeck(activeDeckIndex, clipIndex, clipTime)
    if (!loaded || getActiveVideo() !== video) {
      return
    }

    pendingSeek = false
    mediaState.error = undefined
    fitToViewport(viewport)
    updateFrameState(video)
    syncVideoPresentation()
    void primeStandbyDeck(clipIndex + 1)

    if (autoplay) {
      try {
        await video.play()
      } catch {
        updateFrameState(video)
      }
    }
  }

  async function handoffToNextClip() {
    const nextClipIndex = mediaState.activeClipIndex + 1
    if (nextClipIndex < 0 || nextClipIndex >= playlist.length) {
      updateFrameState()
      return
    }

    const previousActive = getActiveVideo()
    const standbyDeckIndex = 1 - activeDeckIndex
    const standbyVideo = getStandbyVideo()
    if (!standbyVideo) {
      return
    }

    if (deckClipIndices[standbyDeckIndex] !== nextClipIndex) {
      const prepared = await prepareDeck(standbyDeckIndex, nextClipIndex, 0)
      if (!prepared) {
        return
      }
    }

    previousActive?.pause()
    cancelFrameLoop()
    activeDeckIndex = standbyDeckIndex
    mediaState.activeClipIndex = nextClipIndex
    applyActiveClipState(getActiveVideo())
    syncVideoPresentation()
    updateFrameState(getActiveVideo())

    try {
      await getActiveVideo()?.play()
    } catch {
      updateFrameState(getActiveVideo())
    }

    void primeStandbyDeck(nextClipIndex + 1)
  }

  function updateVideoSources(sources: VideoSourceOption[]) {
    clearSources()
    playlist = sources.map(toPlaylistClip)
    syncPlaylistState()

    videoElements.forEach((video, index) => {
      deckLoadTokens[index] += 1
      deckClipIndices[index] = null
      resetVideoElement(video)
    })

    mediaState.ready = false
    mediaState.playing = false
    mediaState.duration = 0
    mediaState.currentTime = 0
    mediaState.playlistCurrentTime = 0
    mediaState.currentFrame = 0
    mediaState.error = undefined
    mediaState.activeClipIndex = playlist.length > 0 ? 0 : -1
    mediaState.activeClipId = playlist[0]?.id
    mediaState.sourceLabel = playlist[0]?.label ?? 'No media loaded'
    mediaState.sourceCount = playlist.length
    mediaState.playlist = clonePlaylistState(playlist)
    mediaState.playlistDuration = getPlaylistDuration(playlist)

    if (!getActiveVideo()) {
      emitter.emit()
      return
    }

    syncVideoPresentation()
    applyVideoLayout()
    emitter.emit()

    if (playlist.length > 0) {
      void activateClip(0, 0, false)
      void refreshPlaylistMetadata()
    }
  }

  function seekToTime(time: number) {
    const activeVideo = getActiveVideo()
    if (!activeVideo || mediaState.activeClipIndex < 0) {
      return
    }
    const duration = Number.isFinite(activeVideo.duration) ? activeVideo.duration : mediaState.duration
    const nextTime = clamp(snapTimeToFrame(time, mediaState.frameRate), 0, duration || 0)
    pendingSeek = true
    // Exact currentTime assignment (no fastSeek) keeps the landing frame-accurate.
    activeVideo.currentTime = nextTime
  }

  function previewSeekToTime(time: number) {
    const activeVideo = getActiveVideo()
    if (!activeVideo) {
      return
    }

    const clip = mediaState.activeClipIndex >= 0 ? playlist[mediaState.activeClipIndex] : undefined
    const duration = Number.isFinite(activeVideo.duration) ? activeVideo.duration : mediaState.duration
    pendingScrubGlobalTime = (clip?.startTime ?? 0) + clamp(time, 0, duration || 0)
    pendingSeek = true

    if (scrubAnimationFrame) {
      return
    }

    scrubAnimationFrame = window.requestAnimationFrame(() => {
      scrubAnimationFrame = 0
      const currentVideo = getActiveVideo()
      const activeClip = mediaState.activeClipIndex >= 0 ? playlist[mediaState.activeClipIndex] : undefined
      if (!currentVideo || pendingScrubGlobalTime === null || !activeClip) {
        return
      }

      const nextTime = pendingScrubGlobalTime - activeClip.startTime
      pendingScrubGlobalTime = null

      // Snap scrub previews to frame centres so the feedback is frame-accurate too.
      currentVideo.currentTime = snapTimeToFrame(nextTime, mediaState.frameRate)
    })
  }

  function seekToPlaylistTime(globalTime: number, autoplay = false, preview = false) {
    const resolved = resolvePlaylistTime(globalTime)
    if (resolved.clipIndex < 0) {
      return
    }

    if (resolved.clipIndex !== mediaState.activeClipIndex) {
      mediaState.playlistCurrentTime = resolved.globalTime
      mediaState.currentTime = resolved.clipTime
      mediaState.currentFrame = timeToFrame(resolved.clipTime, mediaState.frameRate)
      emitter.emit()
      void activateClip(resolved.clipIndex, resolved.clipTime, autoplay)
      return
    }

    if (preview) {
      previewSeekToTime(resolved.clipTime)
      return
    }

    seekToTime(resolved.clipTime)
    if (autoplay) {
      const activeVideo = getActiveVideo()
      if (activeVideo?.paused) {
        void activeVideo.play()
      }
    }
  }

  const actions: ViewerAction[] = [
    { id: 'video-fit', label: 'Fit', onSelect: (nextViewport) => fitToViewport(nextViewport) },
    {
      id: 'video-zoom-in',
      label: 'Zoom in',
      onSelect: (nextViewport) => {
        const center = { x: nextViewport.width / 2, y: nextViewport.height / 2 }
        const before = rawScreenToWorld(center, nextViewport)
        view.scale = clamp(view.scale * 1.2, MIN_SCALE, MAX_SCALE)
        view.offsetX = center.x - before.x * view.scale
        view.offsetY = center.y - before.y * view.scale
        clampOffsets(nextViewport)
        applyVideoLayout()
        emitter.emit()
      },
    },
    {
      id: 'video-zoom-out',
      label: 'Zoom out',
      onSelect: (nextViewport) => {
        const center = { x: nextViewport.width / 2, y: nextViewport.height / 2 }
        const before = rawScreenToWorld(center, nextViewport)
        view.scale = clamp(view.scale / 1.2, MIN_SCALE, MAX_SCALE)
        view.offsetX = center.x - before.x * view.scale
        view.offsetY = center.y - before.y * view.scale
        clampOffsets(nextViewport)
        applyVideoLayout()
        emitter.emit()
      },
    },
  ]

  const adapter: VideoViewerAdapter = {
    id: 'video-viewer',
    targetId: resolvedTargetId,
    name: 'Frame-accurate movie viewer',
    description: 'HTML5 playlist viewer with frame stepping, clip handoff, audio, and shared annotations anchored in video pixel space.',
    space: 'image2d',
    createFrame(origin) {
      // Stamp the current playback position so the annotation is anchored to this
      // exact frame/clip; timeline.ts filters visibility against it during playback.
      const mediaBinding = mediaState.activeClipIndex >= 0
        ? {
            time: mediaState.currentTime,
            frame: mediaState.currentFrame,
            clipId: mediaState.activeClipId,
            clipLabel: mediaState.sourceLabel,
            globalTime: mediaState.playlistCurrentTime,
          }
        : undefined
      return {
        space: 'image2d',
        origin,
        xAxis: { x: 1, y: 0, z: 0 },
        yAxis: { x: 0, y: 1, z: 0 },
        targetId: resolvedTargetId,
        ...(mediaBinding ? { mediaBinding } : {}),
      }
    },
    worldToScreen(worldPoint, nextViewport) {
      return rawWorldToScreen(worldPoint, nextViewport)
    },
    screenToWorld(screenPoint, nextViewport) {
      const world = rawScreenToWorld(screenPoint, nextViewport)
      const { width, height } = getVideoDimensions()
      if (world.x < 0 || world.x > width || world.y < 0 || world.y > height) {
        return null
      }
      return world
    },
    project(frame, localPoint, nextViewport) {
      return rawWorldToScreen(frameToWorld(frame, localPoint), nextViewport)
    },
    screenToFrameLocal(screenPoint, frame, nextViewport) {
      const worldPoint = rawScreenToWorld(screenPoint, nextViewport)
      const { width, height } = getVideoDimensions()
      if (worldPoint.x < 0 || worldPoint.x > width || worldPoint.y < 0 || worldPoint.y > height) {
        return null
      }
      return worldToFrame(frame, worldPoint)
    },
    getProjectionRevision() {
      // Video-space projection changes with zoom, pan, and layout-relative video sizing.
      return [
        view.scale,
        view.offsetX,
        view.offsetY,
        mediaState.width,
        mediaState.height,
      ].join('|')
    },
    renderBackdrop() {},
    formatAnchor(frame) {
      return `video(${frame.origin.x.toFixed(1)}, ${frame.origin.y.toFixed(1)})`
    },
    mountSurface(host): ViewerSurfaceController {
      host.replaceChildren()

      const decks = [0, 1].map(() => {
        const video = document.createElement('video')
        video.playsInline = true
        video.preload = 'auto'
        video.crossOrigin = 'anonymous'
        video.style.position = 'absolute'
        video.style.objectFit = 'fill'
        video.style.borderRadius = '14px'
        video.style.background = '#020617'
        video.style.boxShadow = '0 24px 60px rgba(15, 23, 42, 0.22)'
        video.style.transition = 'opacity 0.12s linear'
        host.appendChild(video)
        return video
      }) as [HTMLVideoElement, HTMLVideoElement]

      videoElements = decks
      activeDeckIndex = 0
      deckClipIndices = [null, null]

      decks.forEach((video, deckIndex) => {
        video.addEventListener('loadedmetadata', () => {
          const clipIndex = deckClipIndices[deckIndex]
          const clip = clipIndex === null ? undefined : playlist[clipIndex]
          if (clip) {
            clip.width = Math.max(video.videoWidth || clip.width, 1)
            clip.height = Math.max(video.videoHeight || clip.height, 1)
            clip.duration = Number.isFinite(video.duration) ? video.duration : clip.duration
            clip.error = undefined
            syncPlaylistState()
            emitter.emit()
          }

          if (deckIndex === activeDeckIndex) {
            mediaState.ready = true
            mediaState.error = undefined
            fitToViewport(viewport)
            updateFrameState(video)
          }
        })
        video.addEventListener('timeupdate', () => updateFrameState(video))
        video.addEventListener('play', () => {
          if (video !== getActiveVideo()) {
            video.pause()
            return
          }
          updateFrameState(video)
          scheduleFrameLoop()
        })
        video.addEventListener('pause', () => {
          if (video !== getActiveVideo()) {
            return
          }
          updateFrameState(video)
          cancelFrameLoop()
        })
        video.addEventListener('seeked', () => {
          if (video !== getActiveVideo()) {
            return
          }
          pendingSeek = false
          updateFrameState(video)
        })
        video.addEventListener('ratechange', () => updateFrameState(video))
        video.addEventListener('volumechange', () => updateFrameState(video))
        video.addEventListener('ended', () => {
          if (video !== getActiveVideo()) {
            return
          }
          void handoffToNextClip()
        })
        video.addEventListener('error', () => {
          const clipIndex = deckClipIndices[deckIndex]
          const clip = clipIndex === null ? undefined : playlist[clipIndex]
          const errorMessage = video.error?.message || 'Unable to load video source'
          if (clip) {
            clip.error = errorMessage
            syncPlaylistState()
          }
          if (deckIndex === activeDeckIndex) {
            mediaState.error = errorMessage
            mediaState.ready = false
            mediaState.playing = false
            emitter.emit()
          }
        })
      })

      syncVideoPresentation()
      updateVideoSources(initialSources)

      return {
        resize(nextViewport) {
          viewport = nextViewport
          ensureInitialized(nextViewport)
          clampOffsets(nextViewport)
          applyVideoLayout()
          emitter.emit()
        },
        dispose() {
          cancelFrameLoop()
          cancelScrubFrame()
          clearSources()
          videoElements.forEach((video) => {
            video?.pause()
            video?.remove()
          })
          videoElements = [null, null]
        },
      }
    },
    subscribe(listener) {
      return emitter.subscribe(listener)
    },
    getActions() {
      return actions
    },
    getStatusBadges() {
      return [
        mediaState.ready ? `${mediaState.width}×${mediaState.height}` : 'No media',
        `${Math.max(mediaState.activeClipIndex + 1, 0)}/${Math.max(mediaState.sourceCount, 1)} clips`,
        `${mediaState.frameRate.toFixed(2)} fps`,
        mediaState.playing ? 'Playing' : 'Paused',
      ]
    },
    getDiagnostics(): ViewerDiagnosticItem[] {
      return [
        { label: 'Source', value: mediaState.sourceLabel },
        { label: 'Clip', value: mediaState.activeClipIndex >= 0 ? `${mediaState.activeClipIndex + 1} / ${Math.max(mediaState.sourceCount, 1)}` : 'n/a' },
        { label: 'Time', value: `${mediaState.currentTime.toFixed(3)}s / ${mediaState.duration.toFixed(3)}s` },
        { label: 'Playlist', value: `${mediaState.playlistCurrentTime.toFixed(3)}s / ${mediaState.playlistDuration.toFixed(3)}s` },
        { label: 'Frame', value: `${mediaState.currentFrame}` },
        { label: 'Audio', value: mediaState.muted ? 'muted' : `${Math.round(mediaState.volume * 100)}%` },
        { label: 'Scrub', value: scrubbing ? (pendingSeek ? 'scrubbing…' : 'previewing') : pendingSeek ? 'seeking…' : 'ready' },
        { label: 'Error', value: mediaState.error ?? 'none' },
      ]
    },
    handleWheel() {
      return false
    },
    beginNavigation(_screenPoint, options) {
      return options.button === 1 || options.altKey || options.shiftKey
    },
    beginViewNavigation() {
      // View-only: any drag pans the (possibly zoomed) video frame.
      return true
    },
    updateNavigation(_screenPoint, delta, nextViewport) {
      view.offsetX += delta.x
      view.offsetY += delta.y
      clampOffsets(nextViewport)
      applyVideoLayout()
      emitter.emit()
    },
    endNavigation() {},
    getMediaState() {
      return getMediaStateSnapshot()
    },
    togglePlayback() {
      const activeVideo = getActiveVideo()
      if (!activeVideo) {
        return
      }
      if (activeVideo.paused) {
        void activeVideo.play()
      } else {
        activeVideo.pause()
      }
    },
    pausePlayback() {
      getActiveVideo()?.pause()
    },
    seekToProgress(progress) {
      const playlistDuration = mediaState.playlistDuration || mediaState.duration
      const nextGlobalTime = playlistDuration * clamp(progress, 0, 1)
      const resolved = resolvePlaylistTime(nextGlobalTime)

      if (resolved.clipIndex >= 0 && resolved.clipIndex === mediaState.activeClipIndex) {
        mediaState.playlistCurrentTime = nextGlobalTime
        mediaState.currentTime = resolved.clipTime
        mediaState.currentFrame = timeToFrame(resolved.clipTime, mediaState.frameRate)
        emitter.emit()
      }

      seekToPlaylistTime(nextGlobalTime, false, false)
    },
    beginScrubbing() {
      scrubbing = true
      const activeVideo = getActiveVideo()
      wasPlayingBeforeScrub = Boolean(activeVideo && !activeVideo.paused)
      if (wasPlayingBeforeScrub) {
        activeVideo?.pause()
      }
      emitter.emit()
    },
    previewSeekToProgress(progress) {
      const playlistDuration = mediaState.playlistDuration || mediaState.duration
      const nextGlobalTime = playlistDuration * clamp(progress, 0, 1)
      seekToPlaylistTime(nextGlobalTime, false, true)
      mediaState.playlistCurrentTime = nextGlobalTime
      const resolved = resolvePlaylistTime(nextGlobalTime)
      mediaState.currentTime = resolved.clipTime
      mediaState.currentFrame = timeToFrame(mediaState.currentTime, mediaState.frameRate)
      emitter.emit()
    },
    endScrubbing(progress) {
      const playlistDuration = mediaState.playlistDuration || mediaState.duration
      scrubbing = false
      pendingScrubGlobalTime = null
      cancelScrubFrame()
      seekToPlaylistTime(playlistDuration * clamp(progress, 0, 1), wasPlayingBeforeScrub, false)
      wasPlayingBeforeScrub = false
      emitter.emit()
    },
    stepFrames(delta) {
      const activeVideo = getActiveVideo()
      const wasPlaying = activeVideo ? !activeVideo.paused : false
      if (wasPlaying) {
        activeVideo?.pause()
      }
      // Step relative to the current integer frame so repeated steps don't drift.
      const currentFrame = timeToFrame(mediaState.currentTime, mediaState.frameRate)
      seekToTime(frameToMidTime(currentFrame + delta, mediaState.frameRate))
    },
    setPlaybackRate(rate) {
      mediaState.playbackRate = rate
      videoElements.forEach((video) => {
        if (video) {
          video.playbackRate = rate
        }
      })
      emitter.emit()
    },
    setFrameRate(rate) {
      mediaState.frameRate = clamp(rate, 1, 240)
      mediaState.currentFrame = timeToFrame(mediaState.currentTime, mediaState.frameRate)
      emitter.emit()
    },
    setMuted(muted) {
      mediaState.muted = muted
      videoElements.forEach((video) => {
        if (video) {
          video.muted = muted
        }
      })
      emitter.emit()
    },
    setVolume(volume) {
      const nextVolume = clamp(volume, 0, 1)
      mediaState.volume = nextVolume
      videoElements.forEach((video) => {
        if (video) {
          video.volume = nextVolume
        }
      })
      emitter.emit()
    },
    loadSources(sources) {
      updateVideoSources(sources)
    },
    loadFiles(files) {
      const list = Array.from(files)
      if (list.length === 0) {
        return
      }
      const nextObjectUrls = list.map((file) => URL.createObjectURL(file))
      updateVideoSources(
        list.map((file, index) => ({
          src: nextObjectUrls[index],
          type: file.type || extensionToMimeType(file.name),
          label: file.name,
        })),
      )
      objectUrls = nextObjectUrls
    },
  }

  return adapter
}
