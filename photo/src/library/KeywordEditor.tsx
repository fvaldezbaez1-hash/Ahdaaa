import { useLiveQuery } from 'dexie-react-hooks'
import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { db } from '../io/db'
import type { PhotoRecord } from '../io/types'
import { Icon } from '../ui/Icon'
import { addKeywordsTo, removeKeywordsFrom } from './actions'
import { countKeywords, normalizeKeyword, parseKeywords, sharedKeywords, suggestKeywords, type KeywordCount } from './keywords'
import './keywords.css'

/** Every keyword in the library with its count, from the keywords index (no photo records loaded). */
export function useKnownKeywords(): KeywordCount[] {
  return (
    useLiveQuery(async () => {
      const keys = (await db.photos.orderBy('keywords').keys()) as string[]
      return countKeywords(keys.map((k) => ({ keywords: [k] })))
    }, []) ?? []
  )
}

/**
 * Keywords of one or several photos: chips to remove, a field to add (Enter
 * or comma; several at once separated by commas) with suggestions from the
 * library. With several photos, keywords only some of them have are dimmed;
 * tapping one adds it to all.
 */
export function KeywordEditor({ ids, compact = false, autoFocus = false }: { ids: readonly string[]; compact?: boolean; autoFocus?: boolean }) {
  const photos = useLiveQuery(() => db.photos.bulkGet([...ids]).then((ps) => ps.filter((p): p is PhotoRecord => !!p)), [ids.join('\n')])
  const known = useKnownKeywords()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
  const { all, some } = useMemo(() => sharedKeywords((photos ?? []).map((p) => p.keywords)), [photos])
  const suggestions = useMemo(() => (open ? suggestKeywords(text, known, all, 8) : []), [open, text, known, all])
  if (!photos) return null
  const many = photos.length > 1

  const add = (words: string[]) => {
    const clean = words.map(normalizeKeyword).filter(Boolean)
    if (!clean.length) return
    void addKeywordsTo(ids, clean)
    setText('')
    setActive(-1)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!suggestions.length) return
      e.preventDefault()
      setOpen(true)
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % suggestions.length : (i <= 0 ? suggestions.length : i) - 1))
    } else if (e.key === 'Enter' || (e.key === 'Tab' && active >= 0) || e.key === ',') {
      const pick = active >= 0 ? suggestions[active] : undefined
      if (!pick && !text.trim()) return
      e.preventDefault()
      add(pick ? [pick] : parseKeywords(text))
    } else if (e.key === 'Escape' && open && suggestions.length) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'Backspace' && !text && all.length) {
      void removeKeywordsFrom(ids, [all[all.length - 1]])
    }
  }

  return (
    <div className={compact ? 'kw compact' : 'kw'}>
      <div className="kw-chips" role="list" aria-label={many ? 'Keywords on the selected photos' : 'Keywords'}>
        {all.map((k) => (
          <span key={k} className="kw-chip" role="listitem">
            {k}
            <button type="button" aria-label={`Remove keyword ${k}`} onClick={() => void removeKeywordsFrom(ids, [k])}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        {some.map((k) => (
          <span key={k} className="kw-chip partial" role="listitem" title="On some of the selected photos">
            <button type="button" className="kw-add-all" aria-label={`Add keyword ${k} to all selected photos`} onClick={() => void addKeywordsTo(ids, [k])}>
              {k}
            </button>
            <button type="button" aria-label={`Remove keyword ${k} from the selected photos`} onClick={() => void removeKeywordsFrom(ids, [k])}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <span className="kw-input-wrap">
          <input
            type="text"
            className="kw-input"
            value={text}
            placeholder={all.length || some.length ? 'Add keyword' : many ? 'Add keywords to the selected photos' : 'Add keywords, e.g. beach, family'}
            aria-label={many ? 'Add a keyword to the selected photos' : 'Add a keyword'}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && suggestions.length > 0}
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            enterKeyHint="done"
            autoCapitalize="none"
            autoComplete="off"
            autoFocus={autoFocus}
            onChange={(e) => {
              setText(e.target.value)
              setOpen(true)
              setActive(-1)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // A pasted list or a word left in the field still counts.
              setOpen(false)
              if (text.trim()) add(parseKeywords(text))
            }}
            onKeyDown={onKey}
          />
          {open && suggestions.length > 0 && (
            <ul className="kw-suggest" role="listbox" id={listId} aria-label="Suggested keywords">
              {suggestions.map((k, i) => (
                <li
                  key={k}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'on' : undefined}
                  // Before the input's blur, so the click lands.
                  onPointerDown={(e) => {
                    e.preventDefault()
                    add([k])
                  }}
                >
                  {k}
                  <span className="muted small tnum">{known.find((x) => x.name === k)?.count ?? ''}</span>
                </li>
              ))}
            </ul>
          )}
        </span>
      </div>
    </div>
  )
}
