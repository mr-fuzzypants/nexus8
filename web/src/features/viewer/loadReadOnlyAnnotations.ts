import * as Y from 'yjs'
import { AnnotationDocumentStore } from '../annotator/core/annotations/store'
import type { AnnotationEntity } from '../annotator/core/annotations/types'
import { getOrCreateAnnotationDoc } from '../annotator/annotatorApi'

function fromBase64(serialized: string): Uint8Array {
  const binary = atob(serialized)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

/**
 * Load an asset's annotations as a flat, read-only list. Hydrates a throwaway
 * Yjs doc from the last persisted state and reads a single snapshot — no
 * collaboration room, presence, or undo history. Used by the view-only viewer
 * to overlay markers without any editing machinery.
 */
export async function loadReadOnlyAnnotations(assetId: number): Promise<AnnotationEntity[]> {
  const doc = await getOrCreateAnnotationDoc(assetId)
  const ydoc = new Y.Doc()
  if (doc.doc_state) {
    try {
      Y.applyUpdate(ydoc, fromBase64(doc.doc_state), 'server-hydrate')
    } catch {
      // Malformed persisted state — fall through to an empty document.
    }
  }
  const store = new AnnotationDocumentStore(ydoc)
  const annotations = store.getSnapshot().annotations
  store.destroy()
  ydoc.destroy()
  return annotations
}
