import * as Y from 'yjs'
import type {
  AnnotationDocumentSnapshot,
  AnnotationEntity,
  AnnotationLayer,
  ViewerSpace,
} from './types'
import { normalizeAnnotationEntity, normalizeAnnotationSnapshot } from './schema'
import { DEFAULT_LAYER } from './types'

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function getAnnotationOrder(annotation: AnnotationEntity) {
  return annotation.drawOrder ?? annotation.createdAt
}

function isSameOrderingGroup(left: AnnotationEntity, right: AnnotationEntity) {
  return left.frame.space === right.frame.space && left.frame.targetId === right.frame.targetId
}

export class AnnotationDocumentStore {
  readonly doc: Y.Doc

  private readonly annotations: Y.Map<AnnotationEntity>
  private readonly layers: Y.Map<AnnotationLayer>
  private readonly undoManager: Y.UndoManager
  private version = 0

  constructor(doc: Y.Doc) {
    this.doc = doc
    this.annotations = this.doc.getMap<AnnotationEntity>('annotations')
    this.layers = this.doc.getMap<AnnotationLayer>('layers')
    this.undoManager = new Y.UndoManager([this.annotations, this.layers])

    if (!this.layers.has(DEFAULT_LAYER.id)) {
      this.layers.set(DEFAULT_LAYER.id, DEFAULT_LAYER)
    }

    this.doc.on('afterTransaction', this.handleTransaction)
  }

  private readonly handleTransaction = () => {
    this.version += 1
  }

  destroy() {
    this.doc.off('afterTransaction', this.handleTransaction)
  }

  subscribe(listener: () => void) {
    const notify = () => listener()
    this.doc.on('afterTransaction', notify)
    return () => this.doc.off('afterTransaction', notify)
  }

  getSnapshot(): AnnotationDocumentSnapshot {
    const annotations = Array.from(this.annotations.values())
      .map((annotation) => normalizeAnnotationEntity(cloneValue(annotation)))
      .sort((left, right) => getAnnotationOrder(left) - getAnnotationOrder(right))
    const layers = Array.from(this.layers.values()).map((layer) => cloneValue(layer))

    return normalizeAnnotationSnapshot({
      annotations,
      layers,
      version: this.version,
    })
  }

  upsertAnnotation(annotation: AnnotationEntity) {
    const existing = this.annotations.get(annotation.id)
    const now = Date.now()
    const normalized = normalizeAnnotationEntity(annotation, { now, existing })
    this.annotations.set(annotation.id, {
      ...normalized,
      drawOrder: existing?.drawOrder ?? normalized.drawOrder ?? normalized.createdAt ?? now,
      createdAt: existing?.createdAt ?? normalized.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
    })
  }

  moveAnnotationBackward(id: string) {
    this.moveAnnotationByOffset(id, -1)
  }

  moveAnnotationForward(id: string) {
    this.moveAnnotationByOffset(id, 1)
  }

  private moveAnnotationByOffset(id: string, offset: -1 | 1) {
    const target = this.annotations.get(id)
    if (!target) {
      return
    }

    const orderedGroup = Array.from(this.annotations.values())
      .filter((annotation) => isSameOrderingGroup(annotation, target))
      .sort((left, right) => getAnnotationOrder(left) - getAnnotationOrder(right))

    const index = orderedGroup.findIndex((annotation) => annotation.id === id)
    const nextIndex = index + offset
    if (index === -1 || nextIndex < 0 || nextIndex >= orderedGroup.length) {
      return
    }

    const reordered = [...orderedGroup]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(nextIndex, 0, moved)

    const now = Date.now()
    this.doc.transact(() => {
      reordered.forEach((annotation, orderIndex) => {
        const existing = this.annotations.get(annotation.id)
        if (!existing) {
          return
        }
        this.annotations.set(annotation.id, {
          ...existing,
          drawOrder: orderIndex,
          updatedAt: now,
          version: (existing.version ?? 0) + 1,
        })
      })
    })
  }

  removeAnnotation(id: string) {
    this.annotations.delete(id)
  }

  clearAnnotations() {
    this.doc.transact(() => {
      Array.from(this.annotations.keys()).forEach((id) => {
        this.annotations.delete(id)
      })
    })
  }

  clearAnnotationsForSpace(space: ViewerSpace) {
    this.doc.transact(() => {
      Array.from(this.annotations.entries()).forEach(([id, annotation]) => {
        if (annotation.frame.space === space) {
          this.annotations.delete(id)
        }
      })
    })
  }

  getAnnotation(id: string) {
    const annotation = this.annotations.get(id)
    return annotation ? normalizeAnnotationEntity(cloneValue(annotation)) : undefined
  }

  undo() {
    this.undoManager.undo()
  }

  redo() {
    this.undoManager.redo()
  }

  canUndo() {
    return this.undoManager.undoStack.length > 0
  }

  canRedo() {
    return this.undoManager.redoStack.length > 0
  }
}
