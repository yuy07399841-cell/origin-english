import { useState } from 'react'
import type {
  AiServiceSettingsUpdate,
  RuntimeStatus,
  SentenceAudioCredentialMode,
  TextAiProvider
} from '../../shared/types'
import type { UiCopy } from './i18n'

interface AiServiceSettingsProps {
  status: RuntimeStatus
  copy: UiCopy
  onboarding: boolean
  topOffset: number
  saving: boolean
  error: string | null
  onSave: (input: AiServiceSettingsUpdate) => void
  onDisconnect: () => void
  onDismissOnboarding: () => void
  onClose: () => void
}

function statusLabel(status: RuntimeStatus, copy: UiCopy): string {
  switch (status.aiAvailability) {
    case 'ready':
      return copy.aiStateReady
    case 'text-only':
      return copy.aiStateTextOnly
    case 'speech-only':
      return copy.aiStateSpeechOnly
    default:
      return copy.aiStateLocal
  }
}

export function AiServiceStatusButton({
  status,
  copy,
  onClick
}: {
  status: RuntimeStatus
  copy: UiCopy
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`ai-service-button state-${status.aiAvailability}`}
      aria-label={`${copy.aiServices}: ${statusLabel(status, copy)}`}
      onClick={onClick}
    >
      <span aria-hidden="true" />
      <span>
        <small>{copy.aiServices}</small>
        <strong>{statusLabel(status, copy)}</strong>
      </span>
    </button>
  )
}

export function AiServiceSettings({
  status,
  copy,
  onboarding,
  topOffset,
  saving,
  error,
  onSave,
  onDisconnect,
  onDismissOnboarding,
  onClose
}: AiServiceSettingsProps): React.JSX.Element {
  const [textProvider, setTextProvider] = useState<TextAiProvider>(status.textAiProvider)
  const [textBaseUrl, setTextBaseUrl] = useState(
    status.textAiProvider === 'openai-compatible'
      ? (status.textAiBaseUrl ?? 'https://api.openai.com/v1')
      : 'https://api.openai.com/v1'
  )
  const [textModel, setTextModel] = useState(
    status.textAiProvider === 'openai-compatible' ? (status.textAiModel ?? '') : ''
  )
  const [textApiKey, setTextApiKey] = useState('')
  const [sentenceAudioEnabled, setSentenceAudioEnabled] = useState(
    status.sentenceAudioEnabled
  )
  const [sentenceAudioCredentialMode, setSentenceAudioCredentialMode] =
    useState<SentenceAudioCredentialMode>(
      status.sentenceAudioEnabled
        ? status.sentenceAudioCredentialMode
        : status.textAiProvider === 'mimo'
          ? 'reuse-text'
          : 'separate'
    )
  const [sentenceAudioApiKey, setSentenceAudioApiKey] = useState('')
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

  const textCredentialAlreadySaved =
    status.textAiEnabled && status.textAiProvider === textProvider
  const speechCredentialAlreadySaved =
    status.sentenceAudioEnabled &&
    status.sentenceAudioCredentialMode === 'separate' &&
    sentenceAudioCredentialMode === 'separate'
  const canReuseTextCredential = textProvider === 'mimo'

  const changeTextProvider = (provider: TextAiProvider): void => {
    setTextProvider(provider)
    if (
      provider === 'mimo' &&
      !(status.sentenceAudioEnabled && status.sentenceAudioCredentialMode === 'separate')
    ) {
      setSentenceAudioCredentialMode('reuse-text')
    } else if (provider !== 'mimo' && sentenceAudioCredentialMode === 'reuse-text') {
      setSentenceAudioCredentialMode('separate')
    }
  }

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    onSave({
      textProvider,
      textBaseUrl,
      textModel,
      textApiKey,
      sentenceAudioEnabled,
      sentenceAudioCredentialMode:
        sentenceAudioEnabled && canReuseTextCredential
          ? sentenceAudioCredentialMode
          : 'separate',
      sentenceAudioApiKey
    })
  }

  return (
    <div className="ai-settings-backdrop" role="presentation" style={{ top: topOffset }}>
      <section
        className="ai-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-settings-title"
        aria-describedby="ai-settings-description"
      >
        <header className="ai-settings-heading">
          <div>
            <span className="eyebrow">{copy.aiSettingsEyebrow}</span>
            <h2 id="ai-settings-title">
              {onboarding ? copy.aiOnboardingTitle : copy.aiSettingsTitle}
            </h2>
            <p id="ai-settings-description">
              {onboarding ? copy.aiOnboardingBody : copy.aiSettingsBody}
            </p>
          </div>
          {!onboarding ? (
            <button
              type="button"
              className="ai-settings-close"
              aria-label={copy.closeAiSettings}
              onClick={onClose}
            >
              ×
            </button>
          ) : null}
        </header>

        <div className="ai-capability-grid">
          <section>
            <h3>{copy.localCapabilitiesTitle}</h3>
            <ul>
              {copy.localCapabilities.map((item) => (
                <li key={item}>
                  <span aria-hidden="true">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>{copy.serviceCapabilitiesTitle}</h3>
            <ul>
              {copy.serviceCapabilities.map((item) => (
                <li key={item}>
                  <span aria-hidden="true">+</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {status.aiConfigurationError || error ? (
          <div className="ai-settings-warning" role="alert">
            <strong>{copy.aiConfigurationErrorTitle}</strong>
            <span>{error ?? status.aiConfigurationError}</span>
          </div>
        ) : null}

        <form onSubmit={submit}>
          <section className="ai-settings-section">
            <div className="ai-settings-section-copy">
              <span className="ai-step">1</span>
              <div>
                <h3>{copy.textAiTitle}</h3>
                <p>{copy.textAiBody}</p>
              </div>
            </div>
            <div className="ai-form-fields">
              <label>
                <span>{copy.textProviderLabel}</span>
                <select
                  value={textProvider}
                  disabled={saving}
                  onChange={(event) => changeTextProvider(event.target.value as TextAiProvider)}
                >
                  <option value="none">{copy.providerNone}</option>
                  <option value="mimo">{copy.providerMimo}</option>
                  <option value="openai-compatible">{copy.providerOpenAiCompatible}</option>
                </select>
              </label>

              {textProvider === 'openai-compatible' ? (
                <div className="ai-inline-fields">
                  <label>
                    <span>{copy.baseUrlLabel}</span>
                    <input
                      type="url"
                      value={textBaseUrl}
                      disabled={saving}
                      required
                      spellCheck={false}
                      onChange={(event) => setTextBaseUrl(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>{copy.modelLabel}</span>
                    <input
                      type="text"
                      value={textModel}
                      disabled={saving}
                      required
                      spellCheck={false}
                      onChange={(event) => setTextModel(event.target.value)}
                    />
                  </label>
                </div>
              ) : null}

              {textProvider !== 'none' ? (
                <label>
                  <span>{copy.apiKeyLabel}</span>
                  <input
                    type="password"
                    value={textApiKey}
                    disabled={saving || !status.secureStorageAvailable}
                    required={!textCredentialAlreadySaved}
                    autoComplete="new-password"
                    placeholder={
                      textCredentialAlreadySaved
                        ? status.textCredentialSource === 'environment'
                          ? copy.environmentCredentialPlaceholder
                          : copy.savedCredentialPlaceholder
                        : copy.newCredentialPlaceholder
                    }
                    onChange={(event) => setTextApiKey(event.target.value)}
                  />
                  <small>
                    {textProvider === 'openai-compatible'
                      ? copy.customProviderWarning
                      : copy.mimoProviderNote}
                  </small>
                </label>
              ) : null}
            </div>
          </section>

          <section className="ai-settings-section">
            <div className="ai-settings-section-copy">
              <span className="ai-step">2</span>
              <div>
                <h3>{copy.naturalAudioTitle}</h3>
                <p>{copy.naturalAudioBody}</p>
              </div>
            </div>
            <div className="ai-form-fields">
              <label className="ai-toggle-row">
                <input
                  type="checkbox"
                  checked={sentenceAudioEnabled}
                  disabled={saving}
                  onChange={(event) => setSentenceAudioEnabled(event.target.checked)}
                />
                <span>{copy.enableNaturalAudio}</span>
              </label>

              {sentenceAudioEnabled && canReuseTextCredential ? (
                <div className="ai-radio-group" role="radiogroup" aria-label={copy.credentialModeLabel}>
                  <label>
                    <input
                      type="radio"
                      name="sentence-audio-credential"
                      value="reuse-text"
                      checked={sentenceAudioCredentialMode === 'reuse-text'}
                      disabled={saving}
                      onChange={() => setSentenceAudioCredentialMode('reuse-text')}
                    />
                    <span>{copy.reuseMimoKey}</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="sentence-audio-credential"
                      value="separate"
                      checked={sentenceAudioCredentialMode === 'separate'}
                      disabled={saving}
                      onChange={() => setSentenceAudioCredentialMode('separate')}
                    />
                    <span>{copy.separateMimoKey}</span>
                  </label>
                </div>
              ) : null}

              {sentenceAudioEnabled &&
              (!canReuseTextCredential || sentenceAudioCredentialMode === 'separate') ? (
                <label>
                  <span>{copy.sentenceAudioApiKeyLabel}</span>
                  <input
                    type="password"
                    value={sentenceAudioApiKey}
                    disabled={saving || !status.secureStorageAvailable}
                    required={!speechCredentialAlreadySaved}
                    autoComplete="new-password"
                    placeholder={
                      speechCredentialAlreadySaved
                        ? copy.savedCredentialPlaceholder
                        : copy.newCredentialPlaceholder
                    }
                    onChange={(event) => setSentenceAudioApiKey(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
          </section>

          <div className={status.secureStorageAvailable ? 'ai-security-note' : 'ai-security-note unavailable'}>
            <span aria-hidden="true">{status.secureStorageAvailable ? '⌁' : '!'}</span>
            <div>
              <strong>
                {status.secureStorageAvailable
                  ? copy.secureStorageTitle
                  : copy.secureStorageUnavailableTitle}
              </strong>
              <p>
                {status.secureStorageAvailable
                  ? copy.secureStorageNote
                  : copy.secureStorageUnavailable}
              </p>
              <small>{copy.noConnectionTestNote}</small>
            </div>
          </div>

          {confirmingDisconnect ? (
            <div className="ai-disconnect-confirmation" role="alert">
              <p>{copy.disconnectWarning}</p>
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={saving}
                  onClick={() => setConfirmingDisconnect(false)}
                >
                  {copy.cancelDisconnect}
                </button>
                <button
                  type="button"
                  className="ai-disconnect-button"
                  disabled={saving}
                  onClick={onDisconnect}
                >
                  {copy.confirmDisconnect}
                </button>
              </div>
            </div>
          ) : null}

          <footer className="ai-settings-actions">
            <div>
              {(status.aiAvailability !== 'local' || status.aiConfigurationError) &&
              !confirmingDisconnect ? (
                <button
                  type="button"
                  className="ai-disconnect-link"
                  disabled={saving}
                  onClick={() => setConfirmingDisconnect(true)}
                >
                  {copy.disconnectAll}
                </button>
              ) : null}
            </div>
            <div>
              <button
                type="button"
                className="secondary-button"
                disabled={saving}
                onClick={onboarding ? onDismissOnboarding : onClose}
              >
                {onboarding ? copy.notNow : copy.closeAiSettings}
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={saving || (!status.secureStorageAvailable && (textProvider !== 'none' || sentenceAudioEnabled))}
              >
                {saving ? copy.savingAiSettings : copy.saveAiSettings}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  )
}
