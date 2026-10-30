import { useId, useState } from 'react'
import { updateSettings, useSettings, type AiProvider, type Settings } from '../state/settings'
import { Field, Segmented, Spinner, Toggle } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { AiError } from './errors'
import { cleanRelayUrl, updatePrefs, usePrefs } from './prefs'
import { formatCost, typicalCost } from './pricing'
import { loadProvider } from './providers'
import { modelFor, PROVIDER_IDS, PROVIDERS } from './providers/meta'
import './assistant.css'

// Rendered inside the Settings screen. Keys are written to this device's
// IndexedDB only (settings.ai.keys) and sent nowhere but the chosen vendor.

const PICK: Record<AiProvider, string> = {
  openai: 'The default: capable, fast and among the least expensive.',
  google: 'Often the lowest price. Needs a paid (billing-enabled) key; see below.',
  anthropic: 'Anthropic officially supports apps like Lumen calling it straight from the browser.',
}

const RETENTION: Record<AiProvider, string> = {
  openai: 'OpenAI says it doesn’t train on API data by default and may keep requests for up to 30 days to monitor abuse. Lumen asks it not to store responses.',
  google: 'With a paid key, Google says it doesn’t use your requests to improve its products; it may keep them for a limited time to monitor abuse.',
  anthropic: 'Anthropic says it doesn’t train on API data by default or keep requests, except content flagged for a safety review.',
}

const setAi = (patch: Partial<Settings['ai']>) => updateSettings((s) => ({ ai: { ...s.ai, ...patch } }))

/** Set or clear one provider's entry in `keys` or `models`. */
function setEntry(field: 'keys' | 'models', provider: AiProvider, value: string) {
  return updateSettings((s) => {
    const next = { ...s.ai[field] }
    if (value.trim()) next[provider] = value.trim()
    else delete next[provider]
    return { ai: { ...s.ai, [field]: next } }
  })
}

export function AiSettings() {
  const settings = useSettings()
  const prefs = usePrefs()
  if (!settings || !prefs) return <Spinner label="Loading AI settings" />
  const ai = settings.ai
  const info = PROVIDERS[ai.provider]
  const model = modelFor(ai.provider, ai.models)
  const relay = ai.provider === 'openai' ? prefs.openaiBaseUrl : undefined
  const cost = typicalCost(model)

  return (
    <div className="ai-set">
      <div className="ai-set-row">
        <div className="grow">
          <b>Use the AI assistant</b>
          <small>“Ask AI” in the editor and AI looks in Presets.</small>
        </div>
        <Toggle checked={ai.enabled} onChange={(enabled) => void setAi({ enabled })} label="Use the AI assistant" />
      </div>

      {ai.enabled && (
        <>
          <hr />
          <div className="stack tight">
            <span className="label">Provider</span>
            <Segmented
              label="AI provider"
              value={ai.provider}
              onChange={(provider) => void setAi({ provider })}
              options={PROVIDER_IDS.map((id) => ({
                value: id,
                label: (
                  <span className="ai-seg">
                    {PROVIDERS[id].vendor}
                    {ai.keys[id] && <i className="ai-key-dot" title="Key saved" />}
                  </span>
                ),
              }))}
            />
            <small className="muted small">{PICK[ai.provider]}</small>
          </div>

          <KeyField key={`key-${ai.provider}`} provider={ai.provider} saved={ai.keys[ai.provider] ?? ''} model={model} baseURL={relay} />

          <ModelField key={`model-${ai.provider}`} provider={ai.provider} saved={ai.models[ai.provider] ?? ''} />

          {ai.provider === 'google' && (
            <div className="ai-set-warning">
              <Icon name="info" size={16} />
              <p>
                <b>Use a paid Gemini key.</b> On Google’s free tier, Google may use your prompts and photo previews to improve its products, and people may review them. Turn on billing for the key’s project in Google AI Studio.
              </p>
            </div>
          )}

          {ai.provider === 'openai' && <RelayField saved={prefs.openaiBaseUrl ?? ''} />}

          <ul className="ai-set-notes">
            <li>
              <Icon name="lock" size={14} />
              <span>
                Your key is stored only in this browser on this device. Lumen has no server: requests go straight from here to {info.vendor}
                {relay ? ' through your relay' : ''}, and nowhere else.
              </span>
            </li>
            <li>
              <Icon name="image" size={14} />
              <span>Each request sends your message, the current slider values and a 1024 px preview of the photo — never the original file.</span>
            </li>
            <li>
              <Icon name="info" size={14} />
              <span>{RETENTION[ai.provider]}</span>
            </li>
            <li>
              <Icon name="key" size={14} />
              <span>
                You pay {info.vendor} directly{cost !== undefined ? `: with ${model}, a typical request costs ${formatCost(cost)}` : ''}. Tip: create a key just for Lumen, with a monthly spending limit.
              </span>
            </li>
          </ul>
        </>
      )}
    </div>
  )
}

type TestState = { state: 'idle' | 'testing' | 'ok' } | { state: 'error'; message: string }

function KeyField({ provider, saved, model, baseURL }: { provider: AiProvider; saved: string; model: string; baseURL?: string }) {
  const info = PROVIDERS[provider]
  const id = useId()
  const [value, setValue] = useState(saved)
  const [show, setShow] = useState(false)
  const [test, setTest] = useState<TestState>({ state: 'idle' })

  const change = (v: string) => {
    setValue(v)
    setTest({ state: 'idle' })
    void setEntry('keys', provider, v)
  }
  const run = async () => {
    setTest({ state: 'testing' })
    try {
      const impl = await loadProvider(provider)
      await impl.testKey({ apiKey: value.trim(), baseURL }, model)
      setTest({ state: 'ok' })
    } catch (e) {
      setTest({ state: 'error', message: e instanceof AiError ? e.message : 'The test request failed. Check your connection and try again.' })
    }
  }

  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {info.vendor} API key
      </label>
      <div className="ai-key">
        <input
          id={id}
          className="input"
          type={show ? 'text' : 'password'}
          value={value}
          placeholder={info.keyPlaceholder}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => change(e.target.value)}
        />
        <button type="button" className="btn sm ghost" aria-pressed={show} onClick={() => setShow(!show)}>
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      <div className="row wrap ai-key-actions">
        <button type="button" className="btn sm" disabled={!value.trim() || test.state === 'testing'} onClick={() => void run()} title="Sends one tiny request (a fraction of a cent)">
          {test.state === 'testing' ? 'Testing…' : 'Test key'}
        </button>
        {value && (
          <button type="button" className="btn sm ghost" onClick={() => change('')}>
            Remove
          </button>
        )}
        <a className="small ai-link" href={info.keyUrl} target="_blank" rel="noreferrer noopener">
          Get a {info.vendor} key
          <Icon name="share" size={13} />
        </a>
      </div>
      <p className={test.state === 'error' ? 'ai-status bad' : test.state === 'ok' ? 'ai-status good' : 'ai-status'} role="status">
        {test.state === 'ok' ? `The key works with ${model}.` : test.state === 'error' ? test.message : value.trim() ? 'Saved on this device only.' : ''}
      </p>
    </div>
  )
}

function ModelField({ provider, saved }: { provider: AiProvider; saved: string }) {
  const info = PROVIDERS[provider]
  const listId = useId()
  const [value, setValue] = useState(saved)
  return (
    <Field label="Model" hint={`Leave empty for the default, ${info.defaultModel}. Any model id from ${info.vendor} that sees images and calls tools works.`}>
      <input
        className="input"
        list={listId}
        value={value}
        placeholder={info.defaultModel}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value)
          void setEntry('models', provider, e.target.value)
        }}
      />
      <datalist id={listId}>
        {info.models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </Field>
  )
}

function RelayField({ saved }: { saved: string }) {
  const [value, setValue] = useState(saved)
  const [bad, setBad] = useState(false)
  const commit = () => {
    const clean = cleanRelayUrl(value)
    setBad(!!value.trim() && !clean)
    if (value.trim() && !clean) return
    void updatePrefs({ openaiBaseUrl: clean })
  }
  return (
    <details className="ai-adv" open={!!saved || undefined}>
      <summary>Advanced: OpenAI relay</summary>
      <Field
        label="Relay URL"
        hint="Only if OpenAI blocks requests from browsers. Point Lumen at a small relay you control (for example a Cloudflare Worker) that forwards to https://api.openai.com/v1. Your key and previews pass through it."
      >
        <input
          className="input"
          type="url"
          inputMode="url"
          value={value}
          placeholder="https://relay.example.com/v1"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      </Field>
      {bad && <p className="ai-status bad">Use a full https:// address.</p>}
    </details>
  )
}
