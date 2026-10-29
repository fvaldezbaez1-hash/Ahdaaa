// OWNER: assistant agent — replace this placeholder. Embedded in the editor
// (right column on desktop, full-height sheet on phones).
export function AssistantPanel({ onClose }: { onClose?: () => void }) {
  return (
    <div className="empty">
      AI assistant
      {onClose && <button onClick={onClose}>Close</button>}
    </div>
  )
}
