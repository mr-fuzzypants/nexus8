import type { LucideIcon } from 'lucide-react'

export interface ViewerToolbarItem {
  id: string
  label: string
  icon?: LucideIcon
  active?: boolean
  disabled?: boolean
  tone?: 'default' | 'danger'
  onSelect: () => void
}

export interface ViewerToolbarGroup {
  id: string
  items: ViewerToolbarItem[]
}

interface ViewerToolbarProps {
  groups: ViewerToolbarGroup[]
}

export function ViewerToolbar({ groups }: ViewerToolbarProps) {
  const populatedGroups = groups.filter((group) => group.items.length > 0)
  if (populatedGroups.length === 0) {
    return null
  }

  return (
    <div className="viewer-toolbar" role="toolbar" aria-label="Viewer toolbar">
      {populatedGroups.map((group) => (
        <div key={group.id} className="viewer-toolbar__group">
          {group.items.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                className={[
                  'viewer-toolbar__button',
                  item.active ? 'is-active' : '',
                  item.tone === 'danger' ? 'is-danger' : '',
                ].filter(Boolean).join(' ')}
                onClick={item.onSelect}
                disabled={item.disabled}
                aria-label={item.label}
                title={item.label}
              >
                {Icon ? <Icon size={16} strokeWidth={2} aria-hidden="true" /> : <span>{item.label}</span>}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}