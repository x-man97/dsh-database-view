/**
 * Public completion surface used by the SQL editor and by the older unit tests.
 *
 * The real implementation lives in `./completion/*` (tokenizer, context,
 * keywords, providers, ranking and the engine). This module is a thin,
 * compatibility-oriented facade: it re-exports the pieces the editor edits
 * with and keeps the pre-refactor ranking helper used by callers that pass
 * their own candidate list.
 */
import { matchScore } from './completion/rank'
import {
  functionCompletions as functionCandidates,
  keywordCompletions as keywordCandidates,
} from './completion/keywords'
import type { Completion, CompletionKind } from './completion/types'

export type { Completion, CompletionKind }
export { matchScore }
export { applyCompletion, qualifierBefore, wordAtCaret } from './completion/edit'

/** True while an IME is composing; Enter there confirms the candidate, not the statement. */
export function composing(event: { nativeEvent: Event }): boolean {
  return (event.nativeEvent as unknown as { isComposing?: boolean }).isComposing === true
}

/** A single typed identifier character may open the completion popup. */
export function opensCompletion(previous: string, next: string): boolean {
  if (next.length !== previous.length + 1) return false
  let index = 0
  while (index < previous.length && previous[index] === next[index]) index += 1
  const typed = next.charAt(index)
  return typed !== '' && /[\w$.\u4e00-\u9fa5`"]/.test(typed)
}

/** Localized label for the right-hand hint of a completion row. */
export function completionKindLabel(
  t: (key: string, params?: Record<string, unknown>) => string,
  kind: CompletionKind,
): string {
  switch (kind) {
    case 'column':
      return t('console.kindColumn')
    case 'table':
      return t('console.kindTable')
    case 'schema':
      return t('console.kindDatabase')
    case 'function':
      return t('console.kindFunction')
    case 'alias':
      return t('console.kindAlias')
    case 'snippet':
      return t('console.kindSnippet')
    case 'keyword':
      return t('console.kindKeyword')
  }
}

/** All SQL keywords, ordered as the editor has always listed them. */
const ALL_KEYWORDS: readonly Completion[] = keywordCandidates('any', 'mysql')

/** Keyword names for callers that only need the list (e.g. syntax hints). */
export const SQL_KEYWORDS: readonly string[] = ALL_KEYWORDS.map((item) => item.name)

/** Keyword candidates in the order the keyword tables declare them. */
export function keywordCompletions(): Completion[] {
  return [...ALL_KEYWORDS]
}

/** Built-in SQL functions, with the opening parenthesis already included. */
export function functionCompletions(): Completion[] {
  return functionCandidates('mysql')
}

/**
 * Rank a caller-provided candidate list for a typed prefix.
 *
 * Kept for callers that already have all the names (tests, command palette
 * style lists); the console itself gets ranked candidates from the engine.
 */
export function completionCandidates(
  prefix: string,
  items: readonly Completion[],
  limit = 50,
): Completion[] {
  const seen = new Set<string>()
  const matched: { item: Completion; score: number; order: number }[] = []
  items.forEach((item, order) => {
    const key = `${item.kind}\u0000${item.name}`
    if (seen.has(key)) return
    const score = matchScore(item.name, prefix)
    if (score < 0) return
    seen.add(key)
    matched.push({ item, score, order })
  })
  matched.sort((left, right) => left.score - right.score || left.order - right.order)
  return matched.slice(0, limit).map((entry) => entry.item)
}
