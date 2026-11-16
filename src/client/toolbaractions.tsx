/**
 * Client-side view of the data-source toolbar: labels, icons, and the saved order.
 *
 * The order lives in DbSettings (stored by the host); App pushes it into this
 * module whenever the settings snapshot changes, the same trick keymap.ts uses
 * for shortcuts.
 */
import { useEffect, useState, type ReactElement } from 'react'
import { orderToolbarActions, type ToolbarActionId } from '../shared/toolbaractions'
import { t } from './i18n'
import { CopyIcon, EditIcon, PlugIcon, PlusIcon, PowerIcon, RecycleIcon, RefreshIcon, TerminalIcon, TrashIcon } from './icons'

export const TOOLBAR_ACTION_LABEL = {
  get add() { return t('app.add') },
  get edit() { return t('app.edit') },
  get duplicate() { return t('app.copy') },
  get refresh() { return t('app.refresh') },
  get disconnect() { return t('app.connectToggle') },
  get delete() { return t('app.delete') },
  get console() { return t('app.console') },
  get trash() { return t('app.trash') },
} as Record<ToolbarActionId, string>

/** Tooltip / accessible name of each toolbar button. */
export const TOOLBAR_ACTION_TITLE = {
  get add() { return t('app.addTitle') },
  get edit() { return t('app.editTitle') },
  get duplicate() { return t('app.copyTitle') },
  get refresh() { return t('app.refreshTitle') },
  get disconnect() { return t('app.connectToggleTitle') },
  get delete() { return t('app.deleteTitle') },
  get console() { return t('app.consoleTitle') },
  get trash() { return t('app.trashTitle') },
} as Record<ToolbarActionId, string>

export function toolbarActionIcon(id: ToolbarActionId, size = 14): ReactElement {
  switch (id) {
    case 'add':
      return <PlusIcon size={size} />
    case 'edit':
      return <EditIcon size={size} />
    case 'duplicate':
      return <CopyIcon size={size} />
    case 'refresh':
      return <RefreshIcon size={size} />
    case 'disconnect':
      return <PlugIcon size={size} />
    case 'delete':
      return <TrashIcon size={size} />
    case 'console':
      return <TerminalIcon size={size} />
    case 'trash':
      return <RecycleIcon size={size} />
  }
}

let savedOrder: ToolbarActionId[] = orderToolbarActions(undefined)
const listeners = new Set<() => void>()

/** Called by App when the settings snapshot loads or changes. */
export function setToolbarActionOrder(stored: readonly string[] | undefined): void {
  const next = orderToolbarActions(stored)
  const same = next.length === savedOrder.length && next.every((id, index) => id === savedOrder[index])
  if (same) return
  savedOrder = next
  for (const listener of listeners) listener()
}

export function currentToolbarActionOrder(): ToolbarActionId[] {
  return savedOrder
}

/** The order to render, re-rendering the caller when settings change. */
export function useToolbarActionOrder(): ToolbarActionId[] {
  const [order, setOrder] = useState<ToolbarActionId[]>(savedOrder)
  useEffect(() => {
    const sync = (): void => {
      setOrder(savedOrder)
    }
    listeners.add(sync)
    sync()
    return () => {
      listeners.delete(sync)
    }
  }, [])
  return order
}
