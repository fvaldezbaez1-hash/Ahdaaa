// OWNER: library agent — replace this placeholder. Shared export dialog used by
// the library (batch) and the editor (current photo).
export function ExportSheet({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  return (
    <div className="empty">
      Export {ids.length} photo(s) <button onClick={onClose}>Close</button>
    </div>
  )
}
