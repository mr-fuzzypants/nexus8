import type { AnnotationEntity, AnnotationTimeRange } from './types'

export interface AnnotationPlaybackState {
  currentTime: number
  playlistCurrentTime: number
  playlistDuration: number
  frameRate: number
  currentFrame: number
  activeClipId?: string
  sourceLabel?: string
}

export interface AnnotationTimelineKey {
  clipId?: string
  clipLabel?: string
  frame: number
  time: number
  globalTime: number
}

function normalizeRange(range: AnnotationTimeRange | undefined) {
  if (!range) {
    return undefined
  }

  const start = Number.isFinite(range.start) ? range.start : 0
  const end = Number.isFinite(range.end) ? range.end : start
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  }
}

export function getAnnotationTimelineKey(annotation: AnnotationEntity): AnnotationTimelineKey | undefined {
  if (annotation.frame.mediaBinding) {
    const binding = annotation.frame.mediaBinding
    return {
      clipId: binding.clipId,
      clipLabel: binding.clipLabel,
      frame: binding.frame,
      time: binding.time,
      globalTime: binding.globalTime ?? binding.time,
    }
  }

  const range = normalizeRange(annotation.timeRange)
  if (!range) {
    return undefined
  }

  return {
    frame: 0,
    time: range.start,
    globalTime: range.start,
  }
}

export function isAnnotationVisibleAtPlaybackTime(
  annotation: AnnotationEntity,
  playback: AnnotationPlaybackState,
) {
  const binding = annotation.frame.mediaBinding
  if (binding) {
    const hasExplicitClipBinding = Boolean(binding.clipId || binding.clipLabel)
    const matchesClipId = Boolean(
      binding.clipId
      && playback.activeClipId
      && binding.clipId === playback.activeClipId,
    )
    const matchesClipLabel = Boolean(
      binding.clipLabel
      && playback.sourceLabel
      && binding.clipLabel === playback.sourceLabel,
    )

    if (hasExplicitClipBinding && !matchesClipId && !matchesClipLabel) {
      return false
    }

    const frameDuration = 1 / Math.max(playback.frameRate, 1)
    const halfFrame = frameDuration * 0.5

    if (
      typeof binding.globalTime === 'number'
      && playback.playlistDuration > 0
      && Math.abs(binding.globalTime - playback.playlistCurrentTime) <= halfFrame
    ) {
      return true
    }

    if (Math.abs(binding.time - playback.currentTime) <= halfFrame) {
      return true
    }

    return binding.frame === playback.currentFrame
  }

  const range = normalizeRange(annotation.timeRange)
  if (!range) {
    return true
  }

  const timelineTime = playback.playlistDuration > 0 ? playback.playlistCurrentTime : playback.currentTime
  return timelineTime >= range.start && timelineTime <= range.end
}