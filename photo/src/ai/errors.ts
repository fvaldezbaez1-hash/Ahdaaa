/** A run needs a model that isn't on this device yet: call downloadModel(modelId) first (after asking). */
export class ModelNotDownloadedError extends Error {
  readonly modelId: string
  constructor(modelId: string, name: string) {
    super(`The ${name} model isn't downloaded yet.`)
    this.name = 'ModelNotDownloadedError'
    this.modelId = modelId
  }
}

/** This device can't run the model (no WebAssembly, too little memory…), in words for people. */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiUnavailableError'
  }
}

export function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}
