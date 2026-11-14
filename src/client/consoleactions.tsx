/**
 * Client-side view of the console toolbar: labels, icons, and the saved order.
 *
 * The order lives in DbSettings (stored by the host) but the console tab is its
 * own Sidebar tab, so App pushes the saved order into this module whenever the
 * settings snapshot changes — the same trick keymap.ts uses for shortcuts.
 */
import { useEffect, useState, type ReactElement } from 'react'
import { orderConsoleActions, type ConsoleActionId } from '../shared/consoleactions'
import { t } from './i18n'
import {
  CheckIcon,
  ClearIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  FormatIcon,
  PlanIcon,
  PlayIcon,
  SaveIcon,
  StopIcon,
  TableIcon,
  TransactionIcon,
  UndoIcon,
  UploadIcon,
} from './icons'

export const CONSOLE_ACTION_LABEL = {
  get run() { return t('console.action.run') },
  get cancel() { return t('console.action.cancel') },
  get history() { return t('console.action.history') },
  get format() { return t('console.action.format') },
  get import() { return t('console.action.import') },
  get save() { return t('console.action.save') },
  get clear() { return t('console.action.clear') },
  get copy() { return t('console.action.copy') },
  get explain() { return t('console.action.explain') },
  get openTable() { return t('console.action.openTable') },
  get txStart() { return t('console.action.txStart') },
  get txCommit() { return t('console.action.txCommit') },
  get txRollback() { return t('console.action.txRollback') },
  get export() { return t('console.action.export') },
} as Record<ConsoleActionId, string>

export function consoleActionIcon(id: ConsoleActionId, size = 12): ReactElement {
  switch (id) {
    case 'run':
      return <PlayIcon size={size} />
    case 'cancel':
      return <StopIcon size={size} />
    case 'history':
      return <ClockIcon size={size} />
    case 'format':
      return <FormatIcon size={size} />
    case 'import':
      return <UploadIcon size={size} />
    case 'save':
      return <SaveIcon size={size} />
    case 'clear':
      return <ClearIcon size={size} />
    case 'copy':
      return <CopyIcon size={size} />
    case 'explain':
      return <PlanIcon size={size} />
    case 'openTable':
      return <TableIcon size={size} />
    case 'txStart':
      return <TransactionIcon size={size} />
    case 'txCommit':
      return <CheckIcon size={size} />
    case 'txRollback':
      return <UndoIcon size={size} />
    case 'export':
      return <DownloadIcon size={size} />
  }
}

let savedOrder: ConsoleActionId[] = orderConsoleActions(undefined)
const listeners = new Set<() => void>()

/** Called by App when the settings snapshot loads or changes. */
export function setConsoleActionOrder(stored: readonly string[] | undefined): void {
  const next = orderConsoleActions(stored)
  const same = next.length === savedOrder.length && next.every((id, index) => id === savedOrder[index])
  if (same) return
  savedOrder = next
  for (const listener of listeners) listener()
}

export function currentConsoleActionOrder(): ConsoleActionId[] {
  return savedOrder
}

/** The order to render, re-rendering the caller when settings change. */
export function useConsoleActionOrder(): ConsoleActionId[] {
  const [order, setOrder] = useState<ConsoleActionId[]>(savedOrder)
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
