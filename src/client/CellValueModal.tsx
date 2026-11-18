/**
 * One cell's whole value: the expanded text, with a copy button and — when the
 * caller can write the cell — an editor for long text and JSON documents. The
 * grid keeps cells to one line, so this is the only place a JSON payload can be
 * read or replaced in full, and JSON keeps its colors while being edited.
 */
import { useEffect, useState, type ReactElement } from 'react'
import type { CellValueView } from './cellvalue'
import { copyText } from './colmenu'
import { useCopyFlash } from './copyflash'
import { JsonHighlight, looksLikeJson } from './jsonhighlight'
import { Button, Modal } from './ui'

export interface CellValueModalProps {
  /** The cell to show; null keeps the dialog closed. */
  view: CellValueView | null
  onClose: () => void
  /** When provided the dialog offers editing; the full text is handed back. */
  onSave?: (text: string) => void
  /** Open directly in edit mode, e.g. double-clicking a JSON cell. */
  editing?: boolean
}

export function CellValueModal({ view, onClose, onSave, editing = false }: CellValueModalProps): ReactElement | null {
  const flash = useCopyFlash()
  const initialMode = view !== null && editing && onSave !== undefined
  const [draft, setDraft] = useState(view?.editText ?? '')
  const [mode, setMode] = useState(initialMode)
  const [shown, setShown] = useState(view)
  // The view object is the identity of one open dialog: a new cell, or the same
  // cell reopened, resets the draft and the mode before anything is painted.
  if (view !== shown) {
    setShown(view)
    setDraft(view?.editText ?? '')
    setMode(view !== null && editing && onSave !== undefined)
  }
  useEffect(() => {
    flash.reset()
  }, [flash.reset, view])
  if (view === null) return null

  const json = view.json || looksLikeJson(draft)
  // Edit and preview must read as the same panel: size both from the text the
  // dialog opened with, capped like the preview's old max-height.
  const lines = view.text.split('\n').length
  const viewportMax = Math.round((typeof window === 'undefined' ? 800 : window.innerHeight) * 0.52)
  const paneHeight = Math.min(viewportMax, Math.max(160, Math.ceil(lines * 18.6) + 26))
  const copy = async (): Promise<void> => {
    flash.flash(await copyText(mode ? draft : view.text))
  }
  const save = (): void => {
    // Switching mode and saving again must not mark an untouched value dirty.
    if (draft !== view.editText) onSave?.(draft)
    onClose()
  }

  return (
    <Modal
      open
      title={`${view.column} · 完整值`}
      onClose={onClose}
      width={640}
      footer={
        <>
          <div className="dshdb-modal-foot-spacer" />
          <Button size="sm" onClick={() => void copy()}>
            {flash.copied ? '已复制' : '复制'}
          </Button>
          {mode ? (
            <>
              <Button
                size="sm"
                onClick={() => {
                  setDraft(view.editText)
                  setMode(false)
                }}
              >
                取消
              </Button>
              <Button size="sm" variant="primary" onClick={save}>
                保存
              </Button>
            </>
          ) : (
            <>
              {onSave === undefined ? null : (
                <Button size="sm" onClick={() => setMode(true)}>
                  编辑
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={onClose}>
                关闭
              </Button>
            </>
          )}
        </>
      }
    >
      {mode ? (
        <div className="dshdb-sql-editor dshdb-cellvalue-editor" style={{ height: paneHeight }}>
          <pre className="dshdb-sql-highlight" aria-hidden="true">
            {json ? <JsonHighlight text={draft} /> : draft}
          </pre>
          <textarea
            className="dshdb-input dshdb-sql-input"
            aria-label="单元格完整值编辑"
            autoFocus
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onScroll={(event) => {
              const pre = event.currentTarget.parentElement?.querySelector('.dshdb-sql-highlight')
              if (pre instanceof HTMLElement) {
                pre.scrollTop = event.currentTarget.scrollTop
                pre.scrollLeft = event.currentTarget.scrollLeft
              }
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                save()
              }
            }}
          />
        </div>
      ) : (
        <pre className="dshdb-cellvalue" style={{ height: paneHeight }} aria-label="单元格完整值">
          {view.json ? <JsonHighlight text={view.text} /> : view.text}
        </pre>
      )}
    </Modal>
  )
}
