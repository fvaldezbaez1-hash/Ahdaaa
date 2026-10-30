import { useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'
import { addUserPreset } from './store'
import { parseXmp, type XmpImport } from './xmp'

interface Report {
  imported: (XmpImport & { file: string })[]
  failed: { file: string; reason: string }[]
}

async function importFiles(files: File[]): Promise<Report> {
  const report: Report = { imported: [], failed: [] }
  for (const f of files) {
    try {
      const r = parseXmp(await f.text(), f.name)
      await addUserPreset({ name: r.name, collection: 'lightroom', source: 'lightroom', description: 'Imported from Lightroom and translated to Lumen’s sliders.', tags: ['lightroom', 'imported'], data: r.data })
      report.imported.push({ ...r, file: f.name })
    } catch (e) {
      report.failed.push({ file: f.name, reason: e instanceof Error ? e.message : String(e) })
    }
  }
  return report
}

/** "Import Lightroom presets": pick .xmp files, add them to From Lightroom, then say what didn't carry over. */
export function XmpImportButton({ className = 'btn outline', onDone }: { className?: string; onDone?: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [report, setReport] = useState<Report | null>(null)
  return (
    <>
      <button type="button" className={className} onClick={() => input.current?.click()}>
        <Icon name="download" size={16} />
        Import Lightroom presets
      </button>
      <input
        ref={input}
        type="file"
        accept=".xmp,application/rdf+xml,application/xml,text/xml"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (!files.length) return
          const r = await importFiles(files)
          setReport(r)
          if (r.imported.length) onDone?.()
        }}
      />
      {report && <ImportReport report={report} onClose={() => setReport(null)} />}
    </>
  )
}

function ImportReport({ report, onClose }: { report: Report; onClose: () => void }) {
  const n = report.imported.length
  return (
    <Sheet
      title={n ? `Imported ${n} Lightroom preset${n === 1 ? '' : 's'}` : 'Nothing imported'}
      onClose={onClose}
      footer={
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <div className="stack">
        {n > 0 && <p className="text-2">They’re in From Lightroom. Settings Lumen doesn’t have are listed below; everything else carried over.</p>}
        <ul className="pp-report">
          {report.imported.map((r) => (
            <li key={r.file + r.name}>
              <div className="row between">
                <b className="ellipsis">{r.name}</b>
                <span className="muted small tnum">{r.mapped} settings</span>
              </div>
              {r.approximated.length > 0 && <p className="small text-2">Approximated: {r.approximated.join(', ')}</p>}
              <p className="small muted">{r.unmapped.length ? `Not carried over: ${r.unmapped.join(', ')}` : 'Everything carried over.'}</p>
            </li>
          ))}
          {report.failed.map((f) => (
            <li key={f.file}>
              <b className="ellipsis">{f.file}</b>
              <p className="small" style={{ color: 'var(--danger)' }}>
                {f.reason}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  )
}
