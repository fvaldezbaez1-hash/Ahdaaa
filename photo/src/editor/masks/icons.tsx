import type { MaskKind } from './model'

// Stroke icons for the masking and healing tools, drawn like ui/Icon (24×24, 1.8 px).
const PATHS: Record<MaskKind | 'ai' | 'eye' | 'eyeOff' | 'heal' | 'invert', string> = {
  brush: 'M18.4 3.6a2 2 0 0 1 2.8 2.8L11 16.6 7.4 13zM7.4 13c-2 0-3.4 1.6-3.4 3.6 0 1.6-.7 2.4-2 3 1 .9 2.6 1.4 4.4 1.4 2.8 0 4.6-1.8 4.6-4.4',
  linear: 'M4 4h16v16H4zM4 9h16M4 15h16',
  radial: 'M12 4a8 6 0 1 0 0 12 8 6 0 1 0 0-12zM12 7.5a4 2.5 0 1 0 0 5 4 2.5 0 1 0 0-5zM12 18v3',
  luminance: 'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18M12 8v8',
  color: 'M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z',
  ai: 'M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  heal: 'M8.5 3.5l12 12a3.5 3.5 0 0 1-5 5l-12-12a3.5 3.5 0 0 1 5-5zM9 12.5l3.5-3.5M11.5 15l3.5-3.5M8 10h.01M14 16h.01',
  invert: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18',
}

export function ToolIcon({ name, size = 18 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  )
}
