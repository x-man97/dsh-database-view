/**
 * One stored Redis value: the metadata line (type / TTL / length) plus the
 * tabulated payload. Shared by the console and the data tree so both present a
 * key the same way.
 */
import { memo, type ReactElement } from 'react'
import type { RedisValue } from '../shared/types'
import { copyText } from './colmenu'
import { formatCount } from './format'
import { CheckIcon, CopyIcon, RefreshIcon } from './icons'
import { useCopyFlash } from './copyflash'
import { useI18n } from './i18n'
import { redisTtlLabel, redisValueTable, redisValueText } from './redisvalue'
import { Tag } from './ui'

const DISPLAY_TEXT_LIMIT = 64 * 1024

export const RedisValuePanel = memo(function RedisValuePanel({
  value,
  showKey = true,
  refreshing = false,
  onRefresh,
}: {
  value: RedisValue
  showKey?: boolean
  refreshing?: boolean
  onRefresh?: () => void
}): ReactElement {
  const t = useI18n()
  const table = redisValueTable(value)
  // A multi-megabyte string would otherwise land in one text node and stall the
  // panel; showing a prefix keeps the key browsable while copy still gets it all.
  const fullText = redisValueText(value.value)
  const text = fullText.slice(0, DISPLAY_TEXT_LIMIT)
  const clippedCells =
    table !== null && table.rows.some((row) => row.some((cell) => cell.length > DISPLAY_TEXT_LIMIT))
  const clipped = fullText.length > DISPLAY_TEXT_LIMIT || clippedCells
  const keyFlash = useCopyFlash()
  const valueFlash = useCopyFlash()
  const copied = keyFlash.copied
  const copiedValue = valueFlash.copied
  return (
    <div className="dshdb-redis-value">
      <div className="dshdb-redis-meta">
        <Tag>{value.type}</Tag>
        <span className="dshdb-muted">{redisTtlLabel(value.ttl)}</span>
        {value.size === undefined ? null : <span className="dshdb-muted">{t('redis.valueCount', { n: formatCount(value.size) })}</span>}
        {value.truncated ? <Tag tone="warn">{t('redis.valueTruncated')}</Tag> : null}
        {onRefresh === undefined ? null : (
          <button
            type="button"
            className="dshdb-row-action"
            title={refreshing ? t('redis.reloading') : t('redis.reloadKey')}
            aria-label={refreshing ? t('redis.refreshingValue') : t('redis.refreshValue')}
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshIcon size={12} />
          </button>
        )}
        <button
          type="button"
          className="dshdb-row-action"
          title={
            value.truncated
              ? copiedValue
                ? t('redis.copiedPartial')
                : t('redis.copyPartial')
              : copiedValue
                ? t('redis.copiedValue')
                : t('redis.copyValue')
          }
          aria-label={copiedValue ? t('redis.valueCopied') : t('redis.copyValue')}
          onClick={() => {
            void copyText(redisValueText(value.value)).then((ok) => valueFlash.flash(ok))
          }}
        >
          {copiedValue ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
        </button>
        {showKey ? (
          <>
            <span className="dshdb-redis-key" title={value.key}>
              {value.key}
            </span>
            <button
              type="button"
              className="dshdb-row-action"
              title={copied ? t('redis.copiedKey') : t('redis.copyKey')}
              aria-label={copied ? t('redis.keyCopied') : t('redis.copyKey')}
              onClick={() => {
                void copyText(value.key).then((ok) => keyFlash.flash(ok))
              }}
            >
              {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            </button>
          </>
        ) : null}
      </div>
      {table === null ? (
        <>
          <pre className="dshdb-console-value">{text}</pre>
          {clipped ? (
            <p className="dshdb-muted" style={{ margin: '6px 0 0' }}>
              {t('redis.largeValue', { kb: DISPLAY_TEXT_LIMIT / 1024 })}
            </p>
          ) : null}
        </>
      ) : (
        <div className="dshdb-grid-wrap dshdb-redis-table">
          <table className="dshdb-grid">
            <thead>
              <tr>
                <th className="dshdb-num">#</th>
                {table.headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index}>
                  <td className="dshdb-num">{index + 1}</td>
                  {row.map((cell, column) => (
                    <td key={column} title={cell.slice(0, 512)}>
                      <span className="dshdb-mono">{cell.slice(0, DISPLAY_TEXT_LIMIT)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {clipped ? (
        <p className="dshdb-muted" style={{ margin: '6px 0 0' }}>
          {t('redis.largeValue', { kb: DISPLAY_TEXT_LIMIT / 1024 })}
        </p>
      ) : null}
    </div>
  )
})
