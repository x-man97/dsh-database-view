import type { ReactElement } from 'react'
import { App, type AppProps } from './App'
import { ConsoleTab, ConsoleTabTitle, type ConsoleTabProps } from './ConsoleTab'
import { TableTab, TableTabTitle, type TableTabProps } from './TableTab'
import { DatabaseIcon } from './icons'
import { SettingsSection } from './SettingsSection'
import { installI18n, t, useI18n } from './i18n'
import { setConsoleTabOpener, setTableTabOpener, type ConsoleTabParams, type TableTabParams } from './tab-open'
import { injectStyles } from './styles'

const PLUGIN_ID = 'dsh-database-view'
const TAB_ID = 'dsh-database-view/database'
const TAB_KIND = 'database'
const TAB_TITLE = '数据库'
const TABLE_TAB_ID = 'dsh-database-view/table'
const TABLE_TAB_KIND = 'database-table'
const TABLE_TAB_TITLE = '数据表'
const CONSOLE_TAB_ID = 'dsh-database-view/console'
const CONSOLE_TAB_KIND = 'database-console'
const CONSOLE_TAB_TITLE = '查询控制台'

interface GuideIconProps {
  size?: number
}

interface GuideEntry {
  id: string
  order: number
  title: () => string
  description?: () => string
  icon?: (props: GuideIconProps) => ReactElement
}

interface SidebarTabDefinition {
  id: string
  kind: string
  title: () => string
  keepMounted?: boolean
  /** Each open gets its own record; a table tab must not replace the database tab. */
  multiple?: boolean
  guide?: GuideEntry[]
}

interface SlotDefinition {
  name: string
  key?: string
  id?: string
  order?: number
  label?: () => string
}

type Disposer = (() => void) | void

interface ClientContext {
  locale: import('./i18n').LocaleService
  sidebarRightTabs: {
    register(definition: SidebarTabDefinition): Disposer
  }
  sidebarRight: {
    openTab(kind: string, options?: { params?: unknown }): void
  }
  slots: {
    register(definition: SlotDefinition, component: (props: Record<string, unknown>) => ReactElement): Disposer
    inject(name: string, callback: () => void): Disposer
  }
  effect(callback: () => void | (() => void), label?: string): Disposer
  inject(names: string[], callback: (host: ClientContext) => void | (() => void), label?: string): Disposer
}

function GuideIcon(props: GuideIconProps): ReactElement {
  return <DatabaseIcon size={props.size ?? 18} />
}

function DatabaseTabBody(props: Record<string, unknown>): ReactElement {
  return <App {...(props as unknown as AppProps)} />
}

/** The database chip in the tab strip: the same database glyph the guide uses. */
function DatabaseTabChip(): ReactElement {
  const t = useI18n()
  return (
    <>
      <DatabaseIcon size={13} />
      <span>{t('nav.database')}</span>
    </>
  )
}

function TableTabBody(props: Record<string, unknown>): ReactElement {
  return <TableTab {...(props as unknown as TableTabProps)} />
}

function TableTabChip(props: Record<string, unknown>): ReactElement {
  return <TableTabTitle {...(props as unknown as TableTabProps)} />
}

function ConsoleTabBody(props: Record<string, unknown>): ReactElement {
  return <ConsoleTab {...(props as unknown as ConsoleTabProps)} />
}

/** Console chips show the terminal glyph through the console's own title. */
function ConsoleTabChip(): ReactElement {
  return <ConsoleTabTitle />
}

function DatabaseSettingsIcon(props: { size?: number; active?: boolean }): ReactElement {
  return <DatabaseIcon size={props.size ?? 16} />
}

export const name = PLUGIN_ID
export const inject: string[] = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => installI18n(ctx.locale), 'dsh-database-view: locale')
  ctx.effect(() => {
    return injectStyles()
  }, 'dsh-database-view: styles')

  // DSH's own Settings panel owns plugin preferences; there is no separate
  // database settings dialog any more.
  ctx.slots.inject('settings.section', () => {
    ctx.slots.register({
      name: 'settings.section',
      id: 'database',
      order: 40,
      label: () => t('settings.nav'),
    }, SettingsSection)
    return undefined
  })

  ctx.slots.inject('settings.section.icon', () => {
    ctx.slots.register({
      name: 'settings.section.icon',
      id: 'database',
    }, DatabaseSettingsIcon)
    return undefined
  })

  // The right Sidebar owns both the tab type list and the keyed body slot.
  // Inject lazily so hosts without the native sidebar do not fail activation.
  ctx.inject(['sidebarRightTabs', 'sidebarRight'], (host) => {
    host.effect(() => {
      // The tab registry owns its registrations until the returned disposer
      // runs; without holding them a live client reload (HMR) re-registers the
      // same ids, throws, and never reaches the pane slot registrations below.
      const tabs = [
        host.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          title: () => t('nav.database'),
          keepMounted: true,
          guide: [
            {
              id: TAB_KIND,
              order: 38,
              title: () => t('nav.database'),
              description: () => t('nav.database'),
              icon: GuideIcon,
            },
          ],
        }),
        // One page per table: `multiple` keeps each double-click's record apart.
        host.sidebarRightTabs.register({
          id: TABLE_TAB_ID,
          kind: TABLE_TAB_KIND,
          title: () => t('nav.table'),
          multiple: true,
        }),
        // Each console open gets its own tab, so every connection can run its own query.
        host.sidebarRightTabs.register({
          id: CONSOLE_TAB_ID,
          kind: CONSOLE_TAB_KIND,
          title: () => t('nav.console'),
          multiple: true,
        }),
      ]
      host.slots.inject('sidebar.right.pane.tab', () => {
        host.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, DatabaseTabBody)
        host.slots.register({ name: 'sidebar.right.pane.tab', key: TABLE_TAB_ID }, TableTabBody)
        host.slots.register({ name: 'sidebar.right.pane.tab', key: CONSOLE_TAB_ID }, ConsoleTabBody)
        return undefined
      })
      host.slots.inject('sidebar.right.pane.tab.title', () => {
        host.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, DatabaseTabChip)
        host.slots.register({ name: 'sidebar.right.pane.tab.title', key: TABLE_TAB_ID }, TableTabChip)
        host.slots.register({ name: 'sidebar.right.pane.tab.title', key: CONSOLE_TAB_ID }, ConsoleTabChip)
        return undefined
      })
      setTableTabOpener((params: TableTabParams) => {
        host.sidebarRight.openTab(TABLE_TAB_KIND, { params })
      })
      setConsoleTabOpener((params: ConsoleTabParams) => {
        host.sidebarRight.openTab(CONSOLE_TAB_KIND, { params })
      })
      return () => {
        for (const dispose of tabs) {
          if (typeof dispose === 'function') dispose()
        }
        setTableTabOpener(undefined)
        setConsoleTabOpener(undefined)
      }
    }, 'dsh-database-view: native right sidebar tab')
  })
}
