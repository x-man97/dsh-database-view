/**
 * View SQL helpers: compose CREATE [OR REPLACE] VIEW, validate the query body
 * and pull the SELECT back out of SHOW CREATE VIEW for editing.
 */
import { quoteMysqlIdent } from './tableddl'

function qualified(schema: string, name: string): string {
  return `${quoteMysqlIdent(schema)}.${quoteMysqlIdent(name)}`
}

export type ViewDraftIssue = 'name' | 'body' | 'not-select'

/** Drop leading SQL comments; null when a block comment is unterminated. */
export function stripLeadingComments(body: string): string | null {
  let text = body.trim()
  for (;;) {
    if (text.startsWith('--')) {
      const newline = text.indexOf('\n')
      if (newline < 0) return null
      text = text.slice(newline + 1).trim()
      continue
    }
    if (text.startsWith('/*')) {
      const end = text.indexOf('*/', 2)
      if (end < 0) return null
      text = text.slice(end + 2).trim()
      continue
    }
    return text
  }
}

export function validateViewDraft(name: string, body: string, requireName = true): ViewDraftIssue | null {
  if (requireName && name.trim() === '') return 'name'
  const text = stripLeadingComments(body)
  if (text === null || text.trim() === '') return 'body'
  return /^(?:select|with)\b/i.test(text) ? null : 'not-select'
}

export function createViewSql(schema: string, name: string, body: string, replace: boolean): string {
  const statement = body.trim().replace(/;+\s*$/u, '')
  return `${replace ? 'CREATE OR REPLACE VIEW' : 'CREATE VIEW'} ${qualified(schema, name.trim())} AS\n${statement}`
}

/** SHOW CREATE VIEW is `... VIEW \`name\` AS select ...`; keep everything after AS. */
export function extractViewSelect(ddl: string): string | null {
  const match = /\bAS\s+(?=(?:select|with)\b)/i.exec(ddl)
  if (match === null) return null
  const body = ddl.slice(match.index + match[0].length).trim().replace(/;+\s*$/u, '')
  return body === '' ? null : body
}