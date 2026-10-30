export function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

export function isAbort(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError'
}
