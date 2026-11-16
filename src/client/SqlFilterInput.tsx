/**
 * One-line SQL input for the table view's WHERE and ORDER BY boxes: a
 * transparent input over the console's syntax highlighter, with completion
 * from the shared engine.
 *
 * The box holds a fragment, not a statement, so completion runs on
 * `SELECT * FROM <table> <clause> <fragment>` and the picked name is mapped
 * back into the fragment. A clause keyword the user typed is kept as-is.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
import type { ClientConnection } from '../shared/types'
import { applyCompletion, completionKindLabel, composing, matchScore, opensCompletion, wordAtCaret } from './complete'
import { ConsoleCompletionCatalog } from './completion/catalog'
import { complete } from './completion/engine'
import type { Completion } from './completion/types'
import { useI18n } from './i18n'
import { usePopoverDismiss } from './popover'
import { SqlHighlight } from './sqlhighlight'
import { qualifiedName } from './tablesql'

export interface SqlFilterInputProps {
  value: string
  onChange: (value: string) => void
  /** Enter with the completion popup closed; the tab applies the box. */
  onEnter: () => void
  /** Escape with the completion popup closed; the tab clears the box. */
  onEscape: () => void
  placeholder: string
  ariaLabel: string
  title?: string
  connectionId: string
  schema: string
  table: string
  dialect: ClientConnection['dialect']
  clause: 'where' | 'order'
  /** Extra class names for the flex slot (`dshdb-qfilter-order` and the like). */
  className?: string
}

const WHERE_LEAD = /^\s*WHERE\b\s*/iu
const ORDER_LEAD = /^\s*ORDER\s+BY\b\s*/iu

interface CompletionText {
  /** Whole statement the engine analyses. */
  statement: string
  /** Caret inside `statement`. */
  caret: number
  /** Where the box text starts; a synthetic clause keyword is not part of it. */
  offset: number
}

/** Wrap the box fragment in a SELECT so the engine knows the table's columns. */
function completionText(value: string, caret: number, clause: 'where' | 'order', table: string): CompletionText {
  const context = `SELECT * FROM ${table} `
  const lead = clause === 'where' ? WHERE_LEAD.exec(value) : ORDER_LEAD.exec(value)
  const keyword = clause === 'where' ? 'WHERE ' : 'ORDER BY '
  const head = lead === null ? keyword : lead[0]
  const rest = lead === null ? value : value.slice(lead[0].length)
  const restCaret = lead === null ? caret : Math.max(0, caret - lead[0].length)
  return {
    statement: `${context}${head}${rest}`,
    caret: context.length + head.length + restCaret,
    offset: context.length + (lead === null ? keyword.length : 0),
  }
}

export const SqlFilterInput = forwardRef<HTMLInputElement, SqlFilterInputProps>(function SqlFilterInput(
  props,
  ref,
): ReactElement {
  const t = useI18n()
  const {
    value,
    onChange: onChangeValue,
    onEnter,
    onEscape,
    placeholder,
    ariaLabel,
    title,
    connectionId,
    schema,
    table,
    dialect,
    clause,
    className,
  } = props
  const [caret, setCaret] = useState(() => value.length)
  const [suggestions, setSuggestions] = useState<Completion[] | null>(null)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
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

  const setInput = useCallback(
    (element: HTMLInputElement | null): void => {
      inputRef.current = element
      if (typeof ref === 'function') ref(element)
      else if (ref !== null) ref.current = element
    },
    [ref],
  )

  useEffect(() => {
    catalogRef.current = null
    abortRef.current?.abort()
    setSuggestions(null)
  }, [connectionId, schema, table])

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      abortRef.current?.abort()
    },
    [],
  )

  // Keeps the highlighted copy under the text as the input scrolls sideways.
  const syncScroll = useCallback((): void => {
    const input = inputRef.current
    if (input === null) return
    const pre = anchorRef.current?.querySelector<HTMLElement>('.dshdb-sql-inline-highlight')
    if (pre !== null && pre !== undefined) pre.scrollLeft = input.scrollLeft
  }, [])

  useEffect(() => {
    syncScroll()
  }, [value, syncScroll])

  const openSuggestions = useCallback(
    async (fragment: string, at: number): Promise<void> => {
      if (connectionId === '' || dialect === 'redis') return
      const catalog =
        catalogRef.current ??
        new ConsoleCompletionCatalog(connectionId, () => (schema === '' ? [] : [schema]))
      catalogRef.current = catalog
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const request = ++requestRef.current
      const text = completionText(fragment, at, clause, qualifiedName(dialect, schema, table))
      try {
        const result = await complete({
          statement: text.statement,
          caret: text.caret,
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
    [clause, connectionId, dialect, schema, table],
  )

  const scheduleSuggestions = useCallback(
    (fragment: string, at: number): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        void openSuggestions(fragment, at)
      }, 120)
    },
    [openSuggestions],
  )

  const insert = (picked: Completion): void => {
    const text = completionText(valueRef.current, caretRef.current, clause, qualifiedName(dialect, schema, table))
    const next = applyCompletion(text.statement, text.caret, picked.insert ?? picked.name, dialect, picked.kind)
    const fragment = next.statement.slice(text.offset)
    const at = Math.max(0, next.caret - text.offset)
    onChangeValue(fragment)
    setSuggestions(null)
    setCaret(at)
    setTimeout(() => {
      const input = inputRef.current
      if (input === null) return
      input.focus()
      input.setSelectionRange(at, at)
      syncScroll()
    }, 0)
  }

  const prefix = wordAtCaret(value, caret).prefix
  const items =
    suggestions === null ? [] : suggestions.filter((item) => matchScore(item.name, prefix) >= 0)
  const activeIndex = items.length === 0 ? 0 : active % items.length

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (composing(event)) return
    if (event.key === 'Escape' && suggestions !== null) {
      event.preventDefault()
      setSuggestions(null)
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
      event.preventDefault()
      const input = event.currentTarget
      void openSuggestions(valueRef.current, input.selectionStart ?? caretRef.current)
      return
    }
    if (suggestions !== null && items.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActive((previous) => (previous + step + items.length) % items.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const picked = items[activeIndex]
        if (picked !== undefined) {
          event.preventDefault()
          insert(picked)
          return
        }
      }
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onEnter()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onEscape()
    }
  }

  return (
    <span
      ref={anchorRef}
      className={`dshdb-qfilter-input dshdb-sql-inline-anchor${className === undefined ? '' : ` ${className}`}`}
    >
      <span className="dshdb-sql-inline">
        <SqlHighlight sql={value} className="dshdb-sql-inline-highlight" trailingNewline={false} />
        <input
          ref={setInput}
          className="dshdb-sql-inline-input"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-controls={suggestions === null ? undefined : `${completeId}-list`}
          aria-activedescendant={
            suggestions !== null && items.length > 0 ? `${completeId}-option-${activeIndex}` : undefined
          }
          title={title}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          onScroll={syncScroll}
          onChange={(event) => {
            const next = event.target.value
            const at = event.target.selectionStart ?? next.length
            setCaret(at)
            onChangeValue(next)
            if (composing(event)) {
              setSuggestions(null)
              return
            }
            if (opensCompletion(value, next)) scheduleSuggestions(next, at)
            else setSuggestions(null)
          }}
          onSelect={(event) => {
            setCaret(event.currentTarget.selectionStart ?? 0)
            syncScroll()
          }}
          onFocus={(event) => setCaret(event.currentTarget.selectionStart ?? value.length)}
          onKeyDown={handleKeyDown}
        />
      </span>
      {suggestions !== null ? (
        <div className="dshdb-complete" id={`${completeId}-list`} role="listbox" aria-label={t('console.completionAria')}>
          {items.length === 0 ? (
            <span className="dshdb-complete-empty">{t('console.noCandidates')}</span>
          ) : (
            items.map((item, index) => (
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
})