/**
 * Presentational pieces of the query console: statement history, the Redis key
 * grid and pager buttons. They read nothing from the console state, so they
 * live here instead of growing ConsoleTab.tsx.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement } from 'react'
import { t } from './i18n'
import type { RedisKeyInfo } from '../shared/types'
import { historyAgo, type HistoryEntry } from './history'
import { ClearIcon, CopyIcon, StarIcon } from './icons'
import { Button, Tag } from './ui'
import { formatCount, formatMs, formatTtl } from './format'
import { copyText } from './colmenu'
import { nextKeySort, sortKeys, sortKeysBySize, sortKeysByTtl, type KeySort } from './redissort'
import { placeMenu, TreeMenu, type TreeMenuState } from './views/tree-menu'

export { formatCount }

/** Fold a statement onto one line for the history rows. */
export function oneLine(statement: string): string {
  return statement.replace(/\s+/gu, ' ').trim()
}

function HistoryRow(props: {
  entry: HistoryEntry
  pinned: boolean
  onPick: (entry: HistoryEntry) => void
  onTogglePin: (entry: HistoryEntry) => void
}): ReactElement {
  return (
    <div className="dshdb-history-line">
      <button
        type="button"
        className="dshdb-history-row"
        title={props.entry.statement}
        onClick={() => props.onPick(props.entry)}
      >
        <span className="dshdb-history-sql">{oneLine(props.entry.statement)}</span>
        <span className="dshdb-history-time">{historyAgo(props.entry.at)}</span>
        {props.entry.rows === undefined && props.entry.elapsedMs === undefined ? null : (
          <span className="dshdb-history-meta">
            {props.entry.rows === undefined
              ? formatMs(props.entry.elapsedMs ?? 0)
              : `${formatCount(props.entry.rows)} ${t('table.rows')} · ${formatMs(props.entry.elapsedMs ?? 0)}`}
          </span>
        )}
      </button>
      <button
        type="button"
        className="dshdb-history-copy"
        aria-label={t('redis.historyCopy')}
        title={t('redis.historyCopy')}
        onClick={() => void copyText(props.entry.statement)}
      >
        <CopyIcon size={11} />
      </button>
      <button
        type="button"
        className="dshdb-history-star"
        data-pinned={props.pinned}
        aria-label={props.pinned ? t('redis.historyUnpin') : t('redis.historyPin')}
        title={props.pinned ? t('redis.historyUnpin') : t('redis.historyPin')}
        onClick={() => props.onTogglePin(props.entry)}
      >
        <StarIcon size={11} filled={props.pinned} />
      </button>
    </div>
  )
}

/** Memoised: the console re-renders on each keystroke, the history list should not. */
export const HistoryPanel = memo(function HistoryPanel(props: {
  entries: HistoryEntry[]
  pins: HistoryEntry[]
  onPick: (entry: HistoryEntry) => void
  onTogglePin: (entry: HistoryEntry) => void
  onClear: () => void
}): ReactElement {
  const [query, setQuery] = useState('')
  // Clearing history is irreversible, so the first click only arms the button.
  const [clearArmed, setClearArmed] = useState(false)
  // Running something new means the user moved on: do not leave the button
  // armed from an earlier click.
  const historyCount = props.entries.length
  useEffect(() => {
    setClearArmed(false)
  }, [historyCount])
  const needle = query.trim().toLowerCase()
  const matches = (entry: HistoryEntry): boolean => needle === '' || entry.statement.toLowerCase().includes(needle)
  const pins = props.pins.filter(matches)
  const entries = props.entries.filter(matches)
  const searchable = props.pins.length + props.entries.length >= 6
  return (
    <div className="dshdb-history">
      {searchable ? (
        <div className="dshdb-history-search">
          <input
            type="search"
            className="dshdb-input"
            aria-label={t('redis.historySearch')}
            placeholder={t('redis.historySearch')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : null}
      {pins.length > 0 ? (
        <div className="dshdb-history-group">
          <div className="dshdb-history-head">
            <span className="dshdb-history-title">{t('redis.historyPinned', { n: pins.length })}</span>
          </div>
          <div className="dshdb-history-list">
            {pins.map((entry, index) => (
              <HistoryRow
                key={`pin-${entry.at}-${index}`}
                entry={entry}
                pinned
                onPick={props.onPick}
                onTogglePin={props.onTogglePin}
              />
            ))}
          </div>
        </div>
      ) : null}
      <div className="dshdb-history-head">
        <span className="dshdb-history-title">{t('redis.historyRecent', { n: entries.length })}</span>
        <Button
          size="sm"
          variant="ghost"
          icon={<ClearIcon size={12} />}
          title={clearArmed ? t('redis.historyConfirmClear') : t('redis.historyClear')}
          onClick={() => {
            if (!clearArmed) {
              setClearArmed(true)
              return
            }
            setClearArmed(false)
            props.onClear()
          }}
        >
          {clearArmed ? t('redis.historyConfirm') : t('redis.clear')}
        </Button>
      </div>
      <div className="dshdb-history-list">
        {entries.length === 0 ? (
          <span className="dshdb-history-empty">{needle === '' ? t('redis.historyEmpty') : t('redis.historyNoMatch')}</span>
        ) : (
          entries.map((entry, index) => (
            <HistoryRow
              key={`${entry.at}-${index}`}
              entry={entry}
              pinned={props.pins.some((item) => item.statement === entry.statement)}
              onPick={props.onPick}
              onTogglePin={props.onTogglePin}
            />
          ))
        )}
      </div>
    </div>
  )
})

/** One key row; memoised so typing in the command box leaves the table alone. */
const KeyRow = memo(function KeyRow({
  info,
  index,
  active,
  onSelect,
  onMenu,
}: {
  info: RedisKeyInfo
  index: number
  active: boolean
  onSelect: (key: RedisKeyInfo) => void
  onMenu: (event: MouseEvent<HTMLTableRowElement>, key: RedisKeyInfo) => void
}): ReactElement {
  return (
    <tr
      data-active={active}
      tabIndex={0}
      onClick={() => onSelect(info)}
      onKeyDown={(event) => {
        // Rows are click targets only; keyboard users get the same selection with Enter or Space.
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect(info)
      }}
      onContextMenu={(event) => onMenu(event, info)}
      style={{ cursor: 'pointer' }}
    >
      <td className="dshdb-num">{index + 1}</td>
      <td title={info.key}>
        <span className="dshdb-mono">{info.key}</span>
      </td>
      <td>
        <Tag>{info.type}</Tag>
      </td>
      <td className="dshdb-num" title={info.ttl < 0 ? t('redis.noExpiry') : t('redis.ttlSeconds', { n: info.ttl })}>
        {formatTtl(info.ttl)}
      </td>
      <td className="dshdb-num">{info.size === undefined ? '' : formatCount(info.size)}</td>
    </tr>
  )
})

export const KeyGrid = memo(function KeyGrid({
  keys,
  selectedKey,
  emptyText,
  onSelect,
}: {
  keys: RedisKeyInfo[]
  selectedKey: string
  emptyText?: string
  onSelect: (key: RedisKeyInfo) => void
}): ReactElement {
  const [sort, setSort] = useState<KeySort>('none')
  const [sizeSort, setSizeSort] = useState<KeySort>('none')
  const [ttlSort, setTtlSort] = useState<KeySort>('none')
  const [menu, setMenu] = useState<TreeMenuState | null>(null)
  const rows = useMemo(
    () => sortKeysBySize(sortKeysByTtl(sortKeys(keys, sort), ttlSort), sizeSort),
    [keys, sort, sizeSort, ttlSort],
  )
  // The menu must keep one identity or every key row re-renders; order comes via the ref.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const openMenu = useCallback((event: MouseEvent<HTMLTableRowElement>, key: RedisKeyInfo): void => {
    event.preventDefault()
    const items = [
      { label: t('redis.copyKey'), run: () => void copyText(key.key) },
      {
        label: t('console.copyKeys'),
        run: () => void copyText(rowsRef.current.map((info) => info.key).join('\n')),
      },
    ]
    setMenu({ ...placeMenu(event.clientX, event.clientY, items), items })
  }, [])
  return (
    <>
    <table className="dshdb-grid" aria-label={t('redis.keyList')}>
      <thead>
        <tr>
          <th className="dshdb-num">#</th>
          <th
            className="dshdb-th-sortable"
            title={sort === 'none' ? t('redis.sortName') : sort === 'asc' ? t('redis.sortNameDesc') : t('redis.restoreScanOrder')}
            data-sorted={sort === 'none' ? undefined : sort}
            aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : 'none'}
            onClick={() => setSort(nextKeySort(sort))}
          >
            {t('redis.key')}
            {sort === 'none' ? null : <span className="dshdb-sort-arrow">{sort === 'asc' ? '▲' : '▼'}</span>}
          </th>
          <th>{t('redis.type')}</th>
          <th
            className="dshdb-th-sortable"
            title={ttlSort === 'none' ? t('redis.sortTtl') : ttlSort === 'asc' ? t('redis.sortTtlDesc') : t('redis.restoreScanOrder')}
            data-sorted={ttlSort === 'none' ? undefined : ttlSort}
            aria-sort={ttlSort === 'asc' ? 'ascending' : ttlSort === 'desc' ? 'descending' : 'none'}
            onClick={() => setTtlSort(nextKeySort(ttlSort))}
          >
            TTL
            {ttlSort === 'none' ? null : <span className="dshdb-sort-arrow">{ttlSort === 'asc' ? '▲' : '▼'}</span>}
          </th>
          <th
            className="dshdb-th-sortable"
            title={sizeSort === 'none' ? t('redis.sortSize') : sizeSort === 'asc' ? t('redis.sortSizeDesc') : t('redis.restoreScanOrder')}
            data-sorted={sizeSort === 'none' ? undefined : sizeSort}
            aria-sort={sizeSort === 'asc' ? 'ascending' : sizeSort === 'desc' ? 'descending' : 'none'}
            onClick={() => setSizeSort(nextKeySort(sizeSort))}
          >
            {t('redis.length')}
            {sizeSort === 'none' ? null : <span className="dshdb-sort-arrow">{sizeSort === 'asc' ? '▲' : '▼'}</span>}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className="dshdb-muted" colSpan={5} style={{ padding: '10px 12px' }}>
              {emptyText ?? t('redis.emptyMatch')}
            </td>
          </tr>
        ) : (
          rows.map((key, index) => (
            <KeyRow
              key={key.key}
              info={key}
              index={index}
              active={key.key === selectedKey}
              onSelect={onSelect}
              onMenu={openMenu}
            />
          ))
        )}
      </tbody>
    </table>
    <TreeMenu menu={menu} onClose={() => setMenu(null)} />
    </>
  )
})

export function PagerButton({
  label,
  title,
  onClick,
  disabled,
}: {
  label: string
  title: string
  onClick: () => void
  disabled: boolean
}): ReactElement {
  return (
    <button type="button" className="dshdb-pager-btn" title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  )
}
