/**
 * Small SQL editor for designer dialogs: a transparent textarea over the same
 * syntax highlighter as the console, with completion from the shared engine.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react'
import type { ClientConnection } from '../shared/types'
import { completionKindLabel, composing, opensCompletion } from './complete'
import { ConsoleCompletionCatalog } from './completion/catalog'
import { applyCompletion } from './completion/edit'
import { complete } from './completion/engine'
import type { Completion } from './completion/types'
import { useI18n } from './i18n'
import { usePopoverDismiss } from './popover'
import { SqlHighlight } from './sqlhighlight'

export interface SqlBodyEditorProps {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  connectionId: string
  schema: string
  dialect: ClientConnection['dialect']
}

export function SqlBodyEditor({
  value,
  onChange,
  ariaLabel,
  placeholder,
  connectionId,
  schema,
  dialect,
}: SqlBodyEditorProps): ReactElement {
  const t = useI18n()
  const [caret, setCaret] = useState(0)
  const [suggestions, setSuggestions] = useState<Completion[] | null>(null)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const catalogRef = useRef<ConsoleCompletionCatalog | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const requestRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const valueRef = useRef(value)
  const caretRef = useRef(caret)
  valueRef.current = value
  caretRef.current = caret
  const completeId = useId().replace(/:/g, '')
  const closeSuggestions = useCallback(() => setSuggestions(null), [])
  usePopoverDismiss(suggestions !== null, closeSuggestions, anchorRef)

  useEffect(() => {
    catalogRef.current = null
    abortRef.current?.abort()
    setSuggestions(null)
  }, [connectionId, schema])

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      abortRef.current?.abort()
    },
    [],
  )

  const openSuggestions = useCallback(
    async (statement: string, at: number): Promise<void> => {
      const catalog =
        catalogRef.current ??
        new ConsoleCompletionCatalog(connectionId, () => (schema === '' ? [] : [schema]))
      catalogRef.current = catalog
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const request = ++requestRef.current
      try {
        const result = await complete({
          statement,
          caret: at,
          dialect,
          schema,
          catalog,
          signal: controller.signal,
        })
        if (request !== requestRef.current) return
        if (result.analysis.inLiteral === true) {
          setSuggestions(null)
          return
        }
        setActive(0)
        setSuggestions(result.items)
      } catch {
        if (request === requestRef.current) setSuggestions(null)
      }
    },
    [connectionId, dialect, schema],
  )

  const scheduleSuggestions = useCallback(
    (statement: string, at: number): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        void openSuggestions(statement, at)
      }, 120)
    },
    [openSuggestions],
  )

  const insert = (picked: Completion): void => {
    const next = applyCompletion(valueRef.current, caretRef.current, picked.insert ?? picked.name, dialect, picked.kind)
    onChange(next.statement)
    setSuggestions(null)
    setCaret(next.caret)
    setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(next.caret, next.caret)
    }, 0)
  }

  const activeIndex = suggestions === null || suggestions.length === 0 ? 0 : active % suggestions.length

  return (
    <span className="dshdb-complete-anchor" ref={anchorRef}>
      <div className="dshdb-sql-editor">
        <SqlHighlight sql={value} className="dshdb-sql-highlight dshdb-view-sql" />
        <textarea
          ref={inputRef}
          className="dshdb-input dshdb-view-sql dshdb-sql-input"
          aria-label={ariaLabel}
          aria-controls={suggestions === null ? undefined : `${completeId}-list`}
          aria-activedescendant={
            suggestions !== null && suggestions.length > 0 ? `${completeId}-option-${activeIndex}` : undefined
          }
          placeholder={placeholder}
          value={value}
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value
            const at = event.target.selectionStart
            setCaret(at)
            onChange(next)
            if (opensCompletion(value, next)) scheduleSuggestions(next, at)
            else setSuggestions(null)
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
          onScroll={(event) => {
            const pre = event.currentTarget.parentElement?.querySelector('.dshdb-sql-highlight')
            if (pre instanceof HTMLElement) {
              pre.scrollTop = event.currentTarget.scrollTop
              pre.scrollLeft = event.currentTarget.scrollLeft
            }
          }}
          onKeyDown={(event) => {
            if (composing(event)) return
            if (event.key === 'Escape' && suggestions !== null) {
              event.preventDefault()
              setSuggestions(null)
              return
            }
            if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
              event.preventDefault()
              void openSuggestions(valueRef.current, caretRef.current)
              return
            }
            if (suggestions !== null && suggestions.length > 0) {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const step = event.key === 'ArrowDown' ? 1 : -1
                setActive((previous) => (previous + step + suggestions.length) % suggestions.length)
                return
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                const picked = suggestions[activeIndex]
                if (picked !== undefined) {
                  event.preventDefault()
                  insert(picked)
                }
              }
            }
          }}
        />
      </div>
      {suggestions !== null ? (
        <div className="dshdb-complete" id={`${completeId}-list`} role="listbox" aria-label={t('console.completionAria')}>
          {suggestions.length === 0 ? (
            <span className="dshdb-complete-empty">{t('console.noCandidates')}</span>
          ) : (
            suggestions.map((item, index) => (
              <button
                key={`${item.kind}:${item.name}`}
                type="button"
                id={`${completeId}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? 'dshdb-complete-item dshdb-complete-active' : 'dshdb-complete-item'}
                onMouseDown={(event) => {
                  event.preventDefault()
                  insert(item)
                }}
              >
                <span className="dshdb-complete-name">{item.name}</span>
                <span className="dshdb-complete-meta">
                  {item.detail === undefined ? null : <span className="dshdb-complete-detail">{item.detail}</span>}
                  <span className="dshdb-complete-kind">{completionKindLabel(t, item.kind)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </span>
  )
}