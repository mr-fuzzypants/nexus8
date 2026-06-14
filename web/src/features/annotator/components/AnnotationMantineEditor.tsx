import '@mantine/core/styles.css'
import { memo, useMemo } from 'react'
import {
  Button,
  ColorInput,
  Divider,
  Group,
  MantineProvider,
  NumberInput,
  Paper,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core'
import type { AnnotationEntity } from '../core/annotations/types'
import type { ViewportSize } from '../core/viewers/adapters'
interface AnnotationMantineEditorProps {
  annotation: AnnotationEntity
  viewport: ViewportSize
  onClose: () => void
  onUpdate: (annotation: AnnotationEntity) => void
  onMoveBackward?: () => void
  onMoveForward?: () => void
  canMoveBackward?: boolean
  canMoveForward?: boolean
  onOpenInline?: () => void
  inlineAvailable?: boolean
}

type TextAnnotation = AnnotationEntity & { geometry: Extract<AnnotationEntity['geometry'], { kind: 'text' }> }
type CardAnnotation = AnnotationEntity & { geometry: Extract<AnnotationEntity['geometry'], { kind: 'card' }> }
type ListAnnotation = AnnotationEntity & { geometry: Extract<AnnotationEntity['geometry'], { kind: 'list' }> }
type GridAnnotation = AnnotationEntity & { geometry: Extract<AnnotationEntity['geometry'], { kind: 'grid' }> }

function getOverlayPosition(viewport: ViewportSize) {
  const width = Math.min(340, Math.max(260, viewport.width - 24))
  const left = Math.max(12, viewport.width - width - 12)
  const top = 12

  return {
    left,
    top,
    width: Math.min(width, viewport.width - 24),
    maxHeight: Math.max(220, viewport.height - 24),
  }
}

function AnnotationMantineEditor({
  annotation,
  viewport,
  onClose,
  onUpdate,
  onMoveBackward,
  onMoveForward,
  canMoveBackward = false,
  canMoveForward = false,
  onOpenInline,
  inlineAvailable = false,
}: AnnotationMantineEditorProps) {
  const overlay = useMemo(() => getOverlayPosition(viewport), [viewport])
  const textAnnotation = annotation.geometry.kind === 'text' ? (annotation as TextAnnotation) : null
  const cardAnnotation = annotation.geometry.kind === 'card' ? (annotation as CardAnnotation) : null
  const listAnnotation = annotation.geometry.kind === 'list' ? (annotation as ListAnnotation) : null
  const gridAnnotation = annotation.geometry.kind === 'grid' ? (annotation as GridAnnotation) : null

  return (
    <MantineProvider defaultColorScheme="dark">
      <Paper
        className="viewer-mantine-editor"
        radius="lg"
        shadow="xl"
        withBorder
        style={{
          left: `${overlay.left}px`,
          top: `${overlay.top}px`,
          width: `${overlay.width}px`,
          maxHeight: `${overlay.maxHeight}px`,
        }}
      >
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <div>
              <Text size="xs" tt="uppercase" c="dimmed" fw={700}>
                2D Editor
              </Text>
              <Text size="sm" fw={700} c="white">
                {annotation.geometry.kind}
              </Text>
            </div>
            <Group gap="xs">
              {inlineAvailable ? (
                <Button variant="light" color="teal" size="compact-sm" onClick={onOpenInline}>
                  Inline edit
                </Button>
              ) : null}
              <Button variant="light" color="gray" size="compact-sm" onClick={onClose}>
                Close
              </Button>
            </Group>
          </Group>

          <Group grow>
            <Button variant="light" color="gray" onClick={onMoveBackward} disabled={!canMoveBackward}>
              Send Backward
            </Button>
            <Button variant="light" color="gray" onClick={onMoveForward} disabled={!canMoveForward}>
              Bring Forward
            </Button>
          </Group>

          {textAnnotation ? (
            <Textarea
              label="Text"
              autosize
              minRows={3}
              value={textAnnotation.geometry.text}
              onChange={(event) => onUpdate({
                ...textAnnotation,
                geometry: {
                  ...textAnnotation.geometry,
                  text: event.currentTarget.value,
                },
              })}
            />
          ) : null}

          {cardAnnotation ? (
            <Textarea
              label="Body"
              autosize
              minRows={5}
              value={cardAnnotation.geometry.body.join('\n')}
              onChange={(event) => onUpdate({
                ...cardAnnotation,
                geometry: {
                  ...cardAnnotation.geometry,
                  body: event.currentTarget.value.split('\n'),
                },
              })}
            />
          ) : null}

          {listAnnotation ? (
            <>
              <TextInput
                label="Title"
                value={listAnnotation.geometry.title}
                onChange={(event) => onUpdate({
                  ...listAnnotation,
                  geometry: {
                    ...listAnnotation.geometry,
                    title: event.currentTarget.value,
                  },
                })}
              />
              <Textarea
                label="Items"
                autosize
                minRows={4}
                value={listAnnotation.geometry.items.join('\n')}
                onChange={(event) => onUpdate({
                  ...listAnnotation,
                  geometry: {
                    ...listAnnotation.geometry,
                    items: event.currentTarget.value.split('\n'),
                  },
                })}
              />
            </>
          ) : null}

          {gridAnnotation ? (
            <>
              <TextInput
                label="Title"
                value={gridAnnotation.geometry.title}
                onChange={(event) => onUpdate({
                  ...gridAnnotation,
                  geometry: {
                    ...gridAnnotation.geometry,
                    title: event.currentTarget.value,
                  },
                })}
              />
              <Group grow align="start">
                <NumberInput
                  label="Rows"
                  min={1}
                  max={12}
                  step={1}
                  value={gridAnnotation.geometry.rows}
                  onChange={(value) => onUpdate({
                    ...gridAnnotation,
                    geometry: {
                      ...gridAnnotation.geometry,
                      rows: typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(12, value)) : gridAnnotation.geometry.rows,
                    },
                  })}
                />
                <NumberInput
                  label="Columns"
                  min={1}
                  max={12}
                  step={1}
                  value={gridAnnotation.geometry.columns}
                  onChange={(value) => onUpdate({
                    ...gridAnnotation,
                    geometry: {
                      ...gridAnnotation.geometry,
                      columns: typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(12, value)) : gridAnnotation.geometry.columns,
                    },
                  })}
                />
              </Group>
            </>
          ) : null}

          <Divider color="rgba(148, 163, 184, 0.18)" />

          <Group grow align="start">
            <ColorInput
              label="Stroke"
              format="rgba"
              value={annotation.style.stroke}
              onChange={(value) => onUpdate({
                ...annotation,
                style: {
                  ...annotation.style,
                  stroke: value,
                },
              })}
            />
            <ColorInput
              label="Fill"
              format="rgba"
              value={annotation.style.fill}
              onChange={(value) => onUpdate({
                ...annotation,
                style: {
                  ...annotation.style,
                  fill: value,
                },
              })}
            />
          </Group>

          <Group grow align="start">
            <NumberInput
              label="Stroke Width"
              min={1}
              max={12}
              step={1}
              value={annotation.style.strokeWidth}
              onChange={(value) => onUpdate({
                ...annotation,
                style: {
                  ...annotation.style,
                  strokeWidth: typeof value === 'number' && Number.isFinite(value) ? value : annotation.style.strokeWidth,
                },
              })}
            />
            <NumberInput
              label="Font Size"
              min={10}
              max={48}
              step={1}
              value={annotation.style.fontSize}
              onChange={(value) => onUpdate({
                ...annotation,
                style: {
                  ...annotation.style,
                  fontSize: typeof value === 'number' && Number.isFinite(value) ? value : annotation.style.fontSize,
                },
              })}
            />
          </Group>

          <div>
            <Text size="sm" fw={500} mb={6} c="white">
              Opacity
            </Text>
            <Slider
              min={0.1}
              max={1}
              step={0.05}
              value={annotation.style.opacity}
              onChange={(value) => onUpdate({
                ...annotation,
                style: {
                  ...annotation.style,
                  opacity: value,
                },
              })}
            />
          </div>

          {annotation.geometry.kind !== 'text' ? (
            <Switch
              label="Dashed outline"
              checked={Boolean(annotation.style.dashed)}
              onChange={(event) => onUpdate({
                ...annotation,
                style: {
                  ...annotation.style,
                  dashed: event.currentTarget.checked,
                },
              })}
            />
          ) : null}
        </Stack>
      </Paper>
    </MantineProvider>
  )
}

const MemoizedAnnotationMantineEditor = memo(AnnotationMantineEditor, (previousProps, nextProps) => (
  previousProps.annotation === nextProps.annotation
  && previousProps.viewport.width === nextProps.viewport.width
  && previousProps.viewport.height === nextProps.viewport.height
  && previousProps.canMoveBackward === nextProps.canMoveBackward
  && previousProps.canMoveForward === nextProps.canMoveForward
  && previousProps.inlineAvailable === nextProps.inlineAvailable
  && previousProps.onClose === nextProps.onClose
  && previousProps.onUpdate === nextProps.onUpdate
  && previousProps.onMoveBackward === nextProps.onMoveBackward
  && previousProps.onMoveForward === nextProps.onMoveForward
  && previousProps.onOpenInline === nextProps.onOpenInline
))

export default MemoizedAnnotationMantineEditor
