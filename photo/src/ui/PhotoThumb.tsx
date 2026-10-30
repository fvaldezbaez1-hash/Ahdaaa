import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../io/db'
import { useObjectUrl } from './hooks'

/** The stored (edited) thumbnail of a photo. Re-renders when the thumb is replaced. */
export function PhotoThumb({ id, alt = '', fit = 'cover', style }: { id: string; alt?: string; fit?: 'cover' | 'contain'; style?: React.CSSProperties }) {
  const thumb = useLiveQuery(() => db.thumbs.get(id), [id])
  const url = useObjectUrl(thumb?.blob)
  if (!url) return <span style={{ display: 'block', width: '100%', height: '100%', background: 'var(--panel-3)', ...style }} aria-hidden="true" />
  return <img src={url} alt={alt} draggable={false} style={{ width: '100%', height: '100%', objectFit: fit, display: 'block', ...style }} />
}
