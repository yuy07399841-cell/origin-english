import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type {
  AppState,
  Article,
  ChineseHintResult,
  DefinitionRequest,
  DefinitionResult,
  ListeningItem,
  RuntimeStatus,
  SavedWord,
  UiLanguage
} from '../../shared/types'
import { toPlainArticleTitle } from '../../shared/article-title'
import { UI_COPY, type UiCopy } from './i18n'
import {
  filterSavedWords,
  resolveNotebookAudioTargets,
  resolveSelectedWord
} from './notebook'
import { getDefinitionRequestFromSelection } from './selection'
import { SentenceAudioSessionCache } from './sentence-audio'
import {
  configureSentenceAudioPlayback,
  SENTENCE_PLAYBACK_RATES,
  type SentencePlaybackRate
} from './speech'
import { usesHeadwordAudio, WordAudioSessionCache } from './word-audio-session'
import { ListeningLibrary, ListeningWorkspace } from './Listening'
import { AiServiceSettings, AiServiceStatusButton } from './AiServiceSettings'

type View = 'reading' | 'listening' | 'notebook'

function errorMessage(error: unknown, copy: UiCopy): string {
  return error instanceof Error ? error.message : copy.genericError
}

interface SentencePlaybackSettingsProps {
  rate: SentencePlaybackRate
  copy: UiCopy
  enabled: boolean
  onRateChange: (rate: SentencePlaybackRate) => void
}

function SentencePlaybackControls({
  rate,
  copy,
  enabled,
  onRateChange
}: SentencePlaybackSettingsProps): React.JSX.Element {
  return (
    <div className="sentence-playback-controls" aria-label={copy.sentenceSpeed}>
      <span>{copy.sentenceSpeed}</span>
      <div>
        {SENTENCE_PLAYBACK_RATES.map((playbackRate) => (
          <button
            key={playbackRate}
            type="button"
            className={rate === playbackRate ? 'active' : ''}
            aria-pressed={rate === playbackRate}
            disabled={!enabled}
            onClick={() => onRateChange(playbackRate)}
          >
            {playbackRate === 1 ? copy.normalSentenceSpeed : copy.slowerSentenceSpeed}
          </button>
        ))}
      </div>
    </div>
  )
}

interface ReadingArticleProps {
  markdown: string
  linksDisabled: string
  onSelectWord: (request: DefinitionRequest) => void
}

function ReadingArticle({
  markdown,
  linksDisabled,
  onSelectWord
}: ReadingArticleProps): React.JSX.Element {
  const articleRef = useRef<HTMLElement>(null)

  const handleSelection = (): void => {
    if (!articleRef.current) return
    const request = getDefinitionRequestFromSelection(
      articleRef.current,
      window.getSelection()
    )
    if (request) onSelectWord(request)
  }

  return (
    <article ref={articleRef} className="reading-paper" onMouseUp={handleSelection}>
      <ReactMarkdown
        components={{
          a: ({ children }) => (
            <span className="safe-link" title={linksDisabled}>
              {children}
            </span>
          )
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  )
}

interface DefinitionPanelProps {
  request: DefinitionRequest | null
  definition: DefinitionResult | null
  loading: boolean
  isSaved: boolean
  copy: UiCopy
  emptyHelp?: string
  sentencePlaybackSettings: SentencePlaybackSettingsProps | null
  sentenceAudioLoading: boolean
  chineseHint: ChineseHintResult | null
  chineseHintVisible: boolean
  loadingChineseHint: boolean
  refiningDefinition: boolean
  audioAttribution: string | null
  wordAudioLoading: boolean
  canUseTextAi: boolean
  onSpeak: (text: string) => void
  onPlayWordAudio: () => void
  onRefineDefinition: () => void
  onToggleChineseHint: () => void
  onSave: () => void
}

function DefinitionPanel({
  request,
  definition,
  loading,
  isSaved,
  copy,
  emptyHelp,
  sentencePlaybackSettings,
  sentenceAudioLoading,
  chineseHint,
  chineseHintVisible,
  loadingChineseHint,
  refiningDefinition,
  audioAttribution,
  wordAudioLoading,
  canUseTextAi,
  onSpeak,
  onPlayWordAudio,
  onRefineDefinition,
  onToggleChineseHint,
  onSave
}: DefinitionPanelProps): React.JSX.Element {
  if (!request) {
    return (
      <aside className="definition-panel definition-empty">
        <span className="eyebrow">{copy.contextCard}</span>
        <div className="selection-mark">Aa</div>
        <h2>{copy.selectWord}</h2>
        <p>{emptyHelp ?? copy.selectWordHelp}</p>
      </aside>
    )
  }

  return (
    <aside className="definition-panel" aria-live="polite">
      <div className="panel-heading">
        <span className="eyebrow">{copy.originalSentence}</span>
        {sentencePlaybackSettings ? (
          <button
            className="icon-button"
            disabled={!sentencePlaybackSettings.enabled || sentenceAudioLoading}
            onClick={() => onSpeak(request.sentence)}
          >
            {sentenceAudioLoading ? copy.preparingSentenceAudio : copy.listen}
          </button>
        ) : null}
      </div>
      <blockquote>{request.sentence}</blockquote>
      {sentencePlaybackSettings ? (
        <SentencePlaybackControls {...sentencePlaybackSettings} />
      ) : null}

      {loading ? (
        <div className="definition-loading">
          <span />
          {copy.preparingDefinition}
        </div>
      ) : definition ? (
        <>
          <div className="source-badge">
            {definition.source === 'simple-wiktionary'
              ? copy.simpleDictionaryBadge
              : definition.source === 'mimo' || definition.source === 'openai-compatible'
                ? copy.mimoLiveBadge
                : copy.localPreviewBadge}
          </div>
          <div className="word-line">
            <div>
              <h2>{definition.word}</h2>
              <span>{definition.partOfSpeech}</span>
              {definition.phonetic ? <i>{definition.phonetic}</i> : null}
            </div>
            {definition.hasAudio ? (
              <button className="icon-button" onClick={onPlayWordAudio} disabled={wordAudioLoading}>
                {wordAudioLoading ? copy.preparingWordPronunciation : copy.wordPronunciation}
              </button>
            ) : null}
          </div>
          {audioAttribution ? <small className="audio-attribution">{audioAttribution}</small> : null}
          <p className="definition-copy">{definition.definition}</p>
          {definition.usage ? (
            <div className="usage-box">
              <span>{copy.usage}</span>
              <p>{definition.usage}</p>
            </div>
          ) : null}
          {definition.source === 'simple-wiktionary' &&
          definition.hasAlternativeSenses &&
          canUseTextAi ? (
            <button
              className="secondary-button definition-action"
              onClick={onRefineDefinition}
              disabled={refiningDefinition}
            >
              {refiningDefinition ? copy.refiningContext : copy.refineWithContext}
            </button>
          ) : null}
          {definition.hasChineseReference || canUseTextAi ? (
            <div className="chinese-hint-block">
              <button className="text-button" onClick={onToggleChineseHint} disabled={loadingChineseHint}>
                {chineseHintVisible ? copy.hideChineseHint : copy.showChineseHint}
              </button>
              {chineseHintVisible ? (
                <div className="chinese-hint" aria-live="polite">
                  <span>
                    {chineseHint?.source === 'ecdict' ||
                    (!chineseHint && definition.hasChineseReference)
                      ? copy.localChineseReferenceLabel
                      : copy.mimoChineseHintLabel}
                  </span>
                  <p>{loadingChineseHint ? copy.preparingChineseHint : chineseHint?.hint}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          <button className="primary-button wide" onClick={onSave} disabled={isSaved}>
            {isSaved ? copy.savedToNotebook : copy.saveWord}
          </button>
        </>
      ) : null}
    </aside>
  )
}

interface ArticleLibraryProps {
  articles: Article[]
  language: UiLanguage
  copy: UiCopy
  onOpen: (articleId: string) => void
  onRequestDelete: (article: Article) => void
}

function ArticleLibrary({
  articles,
  language,
  copy,
  onOpen,
  onRequestDelete
}: ArticleLibraryProps): React.JSX.Element {
  const locale = language === 'zh' ? 'zh-CN' : 'en-US'

  return (
    <main className="library-page">
      <header className="library-heading">
        <div>
          <span className="eyebrow">{copy.libraryEyebrow}</span>
          <h1>{copy.libraryTitle}</h1>
          <p>{copy.libraryBody}</p>
        </div>
        <span>{copy.articleCount(articles.length)}</span>
      </header>

      {articles.length ? (
        <section className="article-list" aria-label={copy.articleListLabel}>
          {articles.map((article) => {
            const title = toPlainArticleTitle(article.title)
            return (
              <article className="article-row" key={article.id}>
                <button
                  type="button"
                  className="article-open-button"
                  aria-label={`${copy.openArticle}: ${title}`}
                  onClick={() => onOpen(article.id)}
                >
                  <span className="article-monogram" aria-hidden="true">
                    {title.charAt(0).toUpperCase() || 'A'}
                  </span>
                  <span className="article-row-copy">
                    <strong>{title}</strong>
                    <span>{article.fileName}</span>
                  </span>
                  <time>{copy.importedOn(new Date(article.importedAt).toLocaleDateString(locale))}</time>
                  <span className="article-open" aria-hidden="true">›</span>
                </button>
                <button
                  type="button"
                  className="article-delete-button"
                  aria-label={`${copy.deleteArticle}: ${title}`}
                  onClick={() => onRequestDelete(article)}
                >
                  {copy.deleteArticle}
                </button>
              </article>
            )
          })}
        </section>
      ) : (
        <section className="empty-library">
          <div className="empty-symbol">R</div>
          <h2>{copy.emptyLibraryTitle}</h2>
          <p>{copy.emptyLibraryBody}</p>
          <small>{copy.fileSupport}</small>
        </section>
      )}
    </main>
  )
}

interface NotebookProps {
  words: SavedWord[]
  language: UiLanguage
  copy: UiCopy
  sentencePlaybackSettings: SentencePlaybackSettingsProps
  sentenceAudioLoading: boolean
  onPlayWordAudio: (word: string) => Promise<string | null>
  onSpeakSentence: (text: string) => void
  onDelete: (id: string) => void
}

function Notebook({
  words,
  language,
  copy,
  sentencePlaybackSettings,
  sentenceAudioLoading,
  onPlayWordAudio,
  onSpeakSentence,
  onDelete
}: NotebookProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedWordId, setSelectedWordId] = useState<string | null>(words[0]?.id ?? null)
  const [loadingWordAudio, setLoadingWordAudio] = useState(false)
  const [wordAudioAttribution, setWordAudioAttribution] = useState<{
    wordId: string
    text: string
  } | null>(null)
  const filteredWords = useMemo(() => filterSavedWords(words, query), [query, words])
  const selectedWord = useMemo(
    () => resolveSelectedWord(filteredWords, selectedWordId),
    [filteredWords, selectedWordId]
  )
  const locale = language === 'zh' ? 'zh-CN' : 'en-US'

  const playSelectedWordAudio = async (): Promise<void> => {
    if (!selectedWord) return
    const targets = resolveNotebookAudioTargets(selectedWord)
    setLoadingWordAudio(true)
    try {
      const attribution = await onPlayWordAudio(targets.dictionaryWord)
      setWordAudioAttribution(
        attribution ? { wordId: selectedWord.id, text: attribution } : null
      )
    } finally {
      setLoadingWordAudio(false)
    }
  }

  return (
    <main className="notebook-page">
      <header className="notebook-heading">
        <div>
          <span className="eyebrow">{copy.notebookEyebrow}</span>
          <h1>{copy.notebookTitle}</h1>
        </div>
        <span>{copy.wordCount(words.length)}</span>
      </header>
      {words.length === 0 ? (
        <div className="notebook-empty">
          <h2>{copy.noSavedWords}</h2>
          <p>{copy.noSavedWordsHelp}</p>
        </div>
      ) : (
        <div className="notebook-workspace">
          <section className="word-list-pane" aria-label={copy.wordListLabel}>
            <label className="word-search">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">{copy.searchWords}</span>
              <input
                type="search"
                value={query}
                placeholder={copy.searchWords}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            {filteredWords.length ? (
              <div className="compact-word-list">
                {filteredWords.map((word) => {
                  const savedDate = new Date(word.savedAt).toLocaleDateString(locale)
                  return (
                    <button
                      className={selectedWord?.id === word.id ? 'compact-word-row active' : 'compact-word-row'}
                      key={word.id}
                      aria-pressed={selectedWord?.id === word.id}
                      onClick={() => setSelectedWordId(word.id)}
                    >
                      <span className="compact-word-name">
                        <strong>{word.word}</strong>
                        <i>{word.partOfSpeech}</i>
                      </span>
                      <span className="compact-definition">{word.definition}</span>
                      <time>{savedDate}</time>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="notebook-search-empty">
                <h2>{copy.noMatchingWords}</h2>
                <p>{copy.noMatchingWordsHelp}</p>
              </div>
            )}
          </section>

          {selectedWord ? (
            <aside className="word-detail" aria-label={copy.selectedWordDetails} aria-live="polite">
              <div className="word-detail-heading">
                <div>
                  <span className="eyebrow">{copy.selectedWordDetails}</span>
                  <h2>{selectedWord.word}</h2>
                  <i>{selectedWord.partOfSpeech}</i>
                </div>
                <button
                  className="icon-button"
                  onClick={() => void playSelectedWordAudio()}
                  disabled={loadingWordAudio}
                >
                  {loadingWordAudio
                    ? copy.preparingWordPronunciation
                    : copy.wordPronunciation}
                </button>
              </div>
              {wordAudioAttribution?.wordId === selectedWord.id ? (
                <small className="audio-attribution">{wordAudioAttribution.text}</small>
              ) : null}

              <section className="word-detail-section">
                <span>{copy.definitionLabel}</span>
                <p>{selectedWord.definition}</p>
              </section>

              {selectedWord.usage ? (
                <section className="word-detail-section detail-usage">
                  <span>{copy.usage}</span>
                  <p>{selectedWord.usage}</p>
                </section>
              ) : null}

              <section className="word-detail-section">
                <div className="word-detail-section-heading">
                  <span>{copy.originalSentence}</span>
                  <button
                    className="text-button"
                    disabled={!sentencePlaybackSettings.enabled || sentenceAudioLoading}
                    onClick={() =>
                      onSpeakSentence(resolveNotebookAudioTargets(selectedWord).systemSentence)
                    }
                  >
                    {sentenceAudioLoading ? copy.preparingSentenceAudio : copy.listenToSentence}
                  </button>
                </div>
                <blockquote>{selectedWord.sentence}</blockquote>
                <SentencePlaybackControls {...sentencePlaybackSettings} />
              </section>

              <footer className="word-detail-footer">
                <time>{copy.savedOn(new Date(selectedWord.savedAt).toLocaleDateString(locale))}</time>
                <button className="text-button danger" onClick={() => onDelete(selectedWord.id)}>
                  {copy.remove}
                </button>
              </footer>
            </aside>
          ) : (
            <aside className="word-detail notebook-search-empty">
              <h2>{copy.noMatchingWords}</h2>
              <p>{copy.noMatchingWordsHelp}</p>
            </aside>
          )}
        </div>
      )}
    </main>
  )
}

export default function App(): React.JSX.Element {
  const [view, setView] = useState<View>('reading')
  const [openArticleId, setOpenArticleId] = useState<string | null>(null)
  const [openListeningId, setOpenListeningId] = useState<string | null>(null)
  const [transcribingListeningId, setTranscribingListeningId] = useState<string | null>(null)
  const [pendingArticleDelete, setPendingArticleDelete] = useState<Article | null>(null)
  const [deletingArticle, setDeletingArticle] = useState(false)
  const [state, setState] = useState<AppState | null>(null)
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null)
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [aiSettingsTop, setAiSettingsTop] = useState(76)
  const [savingAiSettings, setSavingAiSettings] = useState(false)
  const [aiSettingsError, setAiSettingsError] = useState<string | null>(null)
  const [request, setRequest] = useState<DefinitionRequest | null>(null)
  const [definition, setDefinition] = useState<DefinitionResult | null>(null)
  const [loadingDefinition, setLoadingDefinition] = useState(false)
  const [refiningDefinition, setRefiningDefinition] = useState(false)
  const [chineseHint, setChineseHint] = useState<ChineseHintResult | null>(null)
  const [chineseHintVisible, setChineseHintVisible] = useState(false)
  const [loadingChineseHint, setLoadingChineseHint] = useState(false)
  const [audioAttribution, setAudioAttribution] = useState<string | null>(null)
  const [wordAudioLoadingWord, setWordAudioLoadingWord] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sentencePlaybackRate, setSentencePlaybackRate] = useState<SentencePlaybackRate>(1)
  const [sentenceAudioLoadingText, setSentenceAudioLoadingText] = useState<string | null>(null)
  const sentenceAudioCache = useRef(new SentenceAudioSessionCache())
  const wordAudioCache = useRef(new WordAudioSessionCache())
  const lookupSequence = useRef(0)
  const activeSentenceAudio = useRef<HTMLAudioElement | null>(null)
  const topbarRef = useRef<HTMLElement | null>(null)
  const copy = UI_COPY[state?.uiLanguage ?? 'en']

  useEffect(() => {
    Promise.all([window.originEnglish.loadState(), window.originEnglish.getRuntimeStatus()])
      .then(([loadedState, loadedStatus]) => {
        setState(loadedState)
        setRuntimeStatus(loadedStatus)
      })
      .catch((loadError: unknown) => setError(errorMessage(loadError, UI_COPY.en)))
  }, [])

  useEffect(() => {
    if (runtimeStatus && !runtimeStatus.aiOnboardingDismissed) setAiSettingsOpen(true)
  }, [runtimeStatus?.aiOnboardingDismissed])

  useLayoutEffect(() => {
    if (!aiSettingsOpen) return
    const topbar = topbarRef.current
    if (!topbar) return
    const previousOverflow = document.body.style.overflow
    const updateTop = (): void => setAiSettingsTop(topbar.getBoundingClientRect().bottom)
    const observer = new ResizeObserver(updateTop)
    document.body.style.overflow = 'hidden'
    updateTop()
    observer.observe(topbar)
    window.addEventListener('resize', updateTop)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateTop)
      document.body.style.overflow = previousOverflow
    }
  }, [aiSettingsOpen])

  useEffect(
    () => () => {
      activeSentenceAudio.current?.pause()
    },
    []
  )

  useEffect(() => {
    if (!state) return
    document.documentElement.lang = state.uiLanguage === 'zh' ? 'zh-CN' : 'en'
    document.title = state.uiLanguage === 'zh' ? '原境英语' : 'Origin English'
  }, [state?.uiLanguage])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 2_800)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const openArticle = useMemo(
    () => state?.articles.find((article) => article.id === openArticleId) ?? null,
    [openArticleId, state]
  )

  const openListening = useMemo(
    () => state?.listeningItems.find((item) => item.id === openListeningId) ?? null,
    [openListeningId, state]
  )

  const isSaved = useMemo(() => {
    if (!state || !request) return false
    return state.savedWords.some(
      (saved) =>
        saved.word.toLowerCase() === request.word.toLowerCase() &&
        saved.sentence === request.sentence
    )
  }, [request, state])

  useEffect(() => {
    if (!request || !definition?.hasAudio) return
    const word = request.word
    const timeout = window.setTimeout(() => {
      wordAudioCache.current.prefetch(word, () => window.originEnglish.getWordAudio(word))
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [definition?.hasAudio, request?.sentence, request?.word])

  const clearDefinitionSelection = (): void => {
    lookupSequence.current += 1
    activeSentenceAudio.current?.pause()
    setRequest(null)
    setDefinition(null)
    setChineseHint(null)
    setChineseHintVisible(false)
    setAudioAttribution(null)
    setWordAudioLoadingWord(null)
    setLoadingDefinition(false)
    setRefiningDefinition(false)
    setLoadingChineseHint(false)
    setSentenceAudioLoadingText(null)
  }

  const openReading = (articleId: string): void => {
    clearDefinitionSelection()
    setView('reading')
    setOpenListeningId(null)
    setOpenArticleId(articleId)
  }

  const closeReading = (): void => {
    clearDefinitionSelection()
    setOpenArticleId(null)
  }

  const openListeningItem = (itemId: string): void => {
    clearDefinitionSelection()
    setView('listening')
    setOpenArticleId(null)
    setOpenListeningId(itemId)
  }

  const closeListening = (): void => {
    clearDefinitionSelection()
    setOpenListeningId(null)
  }

  const switchLanguage = async (uiLanguage: UiLanguage): Promise<void> => {
    if (!state || state.uiLanguage === uiLanguage) return
    setError(null)
    setNotice(null)
    try {
      setState(await window.originEnglish.setUiLanguage(uiLanguage))
    } catch (languageError) {
      setError(errorMessage(languageError, copy))
    }
  }

  const saveAiServices = async (
    input: Parameters<typeof window.originEnglish.configureAiServices>[0]
  ): Promise<void> => {
    if (savingAiSettings) return
    setSavingAiSettings(true)
    setAiSettingsError(null)
    setNotice(null)
    try {
      setRuntimeStatus(await window.originEnglish.configureAiServices(input))
      setAiSettingsOpen(false)
      setNotice(copy.aiSettingsSaved)
    } catch (settingsError) {
      setAiSettingsError(errorMessage(settingsError, copy))
    } finally {
      setSavingAiSettings(false)
    }
  }

  const disconnectAiServices = async (): Promise<void> => {
    if (savingAiSettings) return
    setSavingAiSettings(true)
    setAiSettingsError(null)
    setNotice(null)
    try {
      setRuntimeStatus(await window.originEnglish.disconnectAiServices())
      setAiSettingsOpen(false)
      setNotice(copy.aiServicesDisconnected)
    } catch (settingsError) {
      setAiSettingsError(errorMessage(settingsError, copy))
    } finally {
      setSavingAiSettings(false)
    }
  }

  const dismissAiOnboarding = async (): Promise<void> => {
    if (savingAiSettings) return
    setSavingAiSettings(true)
    setAiSettingsError(null)
    try {
      setRuntimeStatus(await window.originEnglish.dismissAiOnboarding())
      setAiSettingsOpen(false)
    } catch (settingsError) {
      setAiSettingsError(errorMessage(settingsError, copy))
    } finally {
      setSavingAiSettings(false)
    }
  }

  const importArticle = async (): Promise<void> => {
    setError(null)
    try {
      const article = await window.originEnglish.importMarkdown()
      if (!article) return
      setState((current) =>
        current ? { ...current, articles: [article, ...current.articles] } : current
      )
      clearDefinitionSelection()
      setOpenArticleId(null)
      setOpenListeningId(null)
      setView('reading')
      setNotice(copy.imported(article.fileName))
    } catch (importError) {
      setError(errorMessage(importError, copy))
    }
  }

  const importListening = async (): Promise<void> => {
    setError(null)
    try {
      const item = await window.originEnglish.importListening()
      if (!item) return
      setState((current) =>
        current
          ? { ...current, listeningItems: [item, ...current.listeningItems] }
          : current
      )
      clearDefinitionSelection()
      setOpenArticleId(null)
      setOpenListeningId(null)
      setView('listening')
      setNotice(copy.listeningImported(item.fileName))
    } catch (importError) {
      setError(errorMessage(importError, copy))
    }
  }

  const transcribeListening = async (item: ListeningItem): Promise<void> => {
    if (transcribingListeningId) return
    setTranscribingListeningId(item.id)
    setError(null)
    setNotice(null)
    try {
      const updated = await window.originEnglish.transcribeListening(item.id)
      setState(updated)
      const transcript = updated.listeningItems.find((candidate) => candidate.id === item.id)?.transcript
      if (transcript) setNotice(copy.transcriptReady(transcript.sentences.length))
    } catch (transcriptionError) {
      setError(errorMessage(transcriptionError, copy))
    } finally {
      setTranscribingListeningId(null)
    }
  }

  const deleteArticle = async (): Promise<void> => {
    if (!pendingArticleDelete || deletingArticle) return
    const article = pendingArticleDelete
    const title = toPlainArticleTitle(article.title)
    setDeletingArticle(true)
    setError(null)
    setNotice(null)
    try {
      const updated = await window.originEnglish.deleteArticle(article.id)
      setState(updated)
      if (openArticleId === article.id) {
        clearDefinitionSelection()
        setOpenArticleId(null)
      }
      setPendingArticleDelete(null)
      setNotice(copy.articleDeleted(title))
    } catch (deleteError) {
      setPendingArticleDelete(null)
      setError(errorMessage(deleteError, copy))
    } finally {
      setDeletingArticle(false)
    }
  }

  const selectWord = async (nextRequest: DefinitionRequest): Promise<void> => {
    const sequence = lookupSequence.current + 1
    lookupSequence.current = sequence
    setRequest(nextRequest)
    setDefinition(null)
    setChineseHint(null)
    setChineseHintVisible(false)
    setAudioAttribution(null)
    setWordAudioLoadingWord(null)
    setLoadingDefinition(true)
    setError(null)
    try {
      const result = await window.originEnglish.defineWord(nextRequest)
      if (lookupSequence.current !== sequence) return
      setDefinition(result)
      setLoadingDefinition(false)

      const [recorded, updatedRuntimeStatus] = await Promise.allSettled([
        window.originEnglish.recordLookup({
          ...nextRequest,
          articleId: openArticle?.id ?? null
        }),
        window.originEnglish.getRuntimeStatus()
      ])
      if (lookupSequence.current !== sequence) return

      if (recorded.status === 'fulfilled') {
        setState((current) =>
          current
            ? { ...current, lookupEvents: recorded.value.state.lookupEvents }
            : recorded.value.state
        )
      }
      if (updatedRuntimeStatus.status === 'fulfilled') {
        setRuntimeStatus(updatedRuntimeStatus.value)
      }
      const followUpFailure =
        recorded.status === 'rejected'
          ? recorded.reason
          : updatedRuntimeStatus.status === 'rejected'
            ? updatedRuntimeStatus.reason
            : null
      if (followUpFailure) setError(errorMessage(followUpFailure, copy))
    } catch (definitionError) {
      if (lookupSequence.current !== sequence) return
      setError(errorMessage(definitionError, copy))
      try {
        setRuntimeStatus(await window.originEnglish.getRuntimeStatus())
      } catch {
        // Keep the original lookup error visible.
      }
    } finally {
      if (lookupSequence.current === sequence) setLoadingDefinition(false)
    }
  }

  const refineSelectedDefinition = async (): Promise<void> => {
    if (!request || !definition || !runtimeStatus?.textAiEnabled) return
    setRefiningDefinition(true)
    setError(null)
    setChineseHint(null)
    setChineseHintVisible(false)
    try {
      const refined = await window.originEnglish.refineDefinition(request)
      setDefinition({
        ...refined,
        phonetic: definition.phonetic,
        hasAudio: definition.hasAudio,
        hasChineseReference: definition.hasChineseReference,
        sourceUrl: definition.sourceUrl
      })
      setRuntimeStatus(await window.originEnglish.getRuntimeStatus())
    } catch (refineError) {
      setError(errorMessage(refineError, copy))
    } finally {
      setRefiningDefinition(false)
    }
  }

  const toggleChineseHint = async (): Promise<void> => {
    if (
      !request ||
      !definition ||
      (!definition.hasChineseReference && !runtimeStatus?.textAiEnabled)
    ) {
      return
    }
    if (chineseHintVisible) {
      setChineseHintVisible(false)
      return
    }
    setChineseHintVisible(true)
    if (chineseHint) return

    setLoadingChineseHint(true)
    setError(null)
    try {
      const result = await window.originEnglish.getChineseHint({
        ...request,
        definition: definition.definition
      })
      setChineseHint(result)
      setRuntimeStatus(await window.originEnglish.getRuntimeStatus())
    } catch (hintError) {
      setChineseHintVisible(false)
      setError(errorMessage(hintError, copy))
    } finally {
      setLoadingChineseHint(false)
    }
  }

  const playDictionaryWordAudio = async (word: string): Promise<string | null> => {
    const wordKey = word.trim().toLowerCase()
    setWordAudioLoadingWord(wordKey)
    setError(null)
    try {
      const result = await wordAudioCache.current.get(word, () =>
        window.originEnglish.getWordAudio(word)
      )
      const audio = new Audio(result.dataUrl)
      await audio.play()
      return usesHeadwordAudio(word, result.sourceWord)
        ? copy.headwordAudioAttribution(result.sourceWord, result.artist, result.license)
        : copy.audioAttribution(result.artist, result.license)
    } catch (audioError) {
      const message =
        audioError instanceof Error &&
        audioError.message === 'No recorded pronunciation is available for this word.'
          ? copy.noRecordedPronunciation
          : errorMessage(audioError, copy)
      setError(message)
      return null
    } finally {
      setWordAudioLoadingWord((current) => (current === wordKey ? null : current))
    }
  }

  const playSelectedWordAudio = async (): Promise<void> => {
    if (!request) return
    setAudioAttribution(await playDictionaryWordAudio(request.word))
  }

  const saveSelectedWord = async (): Promise<void> => {
    if (!request || !definition || !state) return
    try {
      const updated = await window.originEnglish.saveWord({
        word: definition.word,
        sentence: request.sentence,
        partOfSpeech: definition.partOfSpeech,
        definition: definition.definition,
        usage: definition.usage,
        articleId: openArticle?.id ?? null
      })
      setState(updated)
      setNotice(copy.savedLocally(definition.word))
    } catch (saveError) {
      setError(errorMessage(saveError, copy))
    }
  }

  const deleteWord = async (id: string): Promise<void> => {
    try {
      const updated = await window.originEnglish.deleteWord(id)
      setState(updated)
    } catch (deleteError) {
      setError(errorMessage(deleteError, copy))
    }
  }

  const playSentence = async (text: string): Promise<void> => {
    if (!runtimeStatus?.sentenceAudioEnabled) {
      setError(copy.naturalSentenceAudioUnavailable)
      return
    }
    setSentenceAudioLoadingText(text)
    setError(null)
    try {
      const { result, loaded } = await sentenceAudioCache.current.get(text, () =>
        window.originEnglish.getSentenceAudio({ sentence: text })
      )
      if (loaded && !result.cached) {
        setRuntimeStatus(await window.originEnglish.getRuntimeStatus())
      }
      activeSentenceAudio.current?.pause()
      const audio = new Audio(result.dataUrl)
      configureSentenceAudioPlayback(audio, sentencePlaybackRate)
      activeSentenceAudio.current = audio
      await audio.play()
    } catch (speechError) {
      setError(errorMessage(speechError, copy))
    } finally {
      setSentenceAudioLoadingText((current) => (current === text ? null : current))
    }
  }

  const changeSentencePlaybackRate = (rate: SentencePlaybackRate): void => {
    setSentencePlaybackRate(rate)
    if (activeSentenceAudio.current) {
      configureSentenceAudioPlayback(activeSentenceAudio.current, rate)
    }
  }

  const sentencePlaybackSettings: SentencePlaybackSettingsProps = {
    rate: sentencePlaybackRate,
    copy,
    enabled: runtimeStatus?.sentenceAudioEnabled ?? false,
    onRateChange: changeSentencePlaybackRate
  }

  if (!state || !runtimeStatus) {
    if (error) {
      return (
        <div className="load-failure" role="alert">
          <span className="eyebrow">Unable to open local data</span>
          <h1>Your reading space could not start.</h1>
          <p>{error}</p>
        </div>
      )
    }
    return (
      <div className="app-loading" aria-label="Loading">
        <span />
      </div>
    )
  }

  const transientMessages = (
    <>
      {error ? (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => setError(null)}>{copy.dismiss}</button>
        </div>
      ) : null}
      {notice ? <div className="toast">{notice}</div> : null}
    </>
  )

  if (view === 'reading' && openArticle) {
    return (
      <div className="app-shell focused-reader-shell">
        <header className="reader-titlebar">
          <button className="back-button" onClick={closeReading}>
            <span aria-hidden="true">‹</span>
            {copy.backToLibrary}
          </button>
          <span className="reader-window-title">{toPlainArticleTitle(openArticle.title)}</span>
        </header>
        {transientMessages}
        <main className="focused-reading-layout">
          <section className="article-column focused-article-column">
            <ReadingArticle
              markdown={openArticle.markdown}
              linksDisabled={copy.linksDisabled}
              onSelectWord={selectWord}
            />
          </section>
          <DefinitionPanel
            request={request}
            definition={definition}
            loading={loadingDefinition}
            isSaved={isSaved}
            copy={copy}
            sentencePlaybackSettings={sentencePlaybackSettings}
            sentenceAudioLoading={sentenceAudioLoadingText === request?.sentence}
            chineseHint={chineseHint}
            chineseHintVisible={chineseHintVisible}
            loadingChineseHint={loadingChineseHint}
            refiningDefinition={refiningDefinition}
            audioAttribution={audioAttribution}
            wordAudioLoading={wordAudioLoadingWord === request?.word.trim().toLowerCase()}
            canUseTextAi={runtimeStatus.textAiEnabled}
            onSpeak={(text) => void playSentence(text)}
            onPlayWordAudio={() => void playSelectedWordAudio()}
            onRefineDefinition={refineSelectedDefinition}
            onToggleChineseHint={toggleChineseHint}
            onSave={saveSelectedWord}
          />
        </main>
      </div>
    )
  }

  if (view === 'listening' && openListening) {
    return (
      <div className="app-shell focused-listening-shell">
        <header className="reader-titlebar">
          <button className="back-button" onClick={closeListening}>
            <span aria-hidden="true">‹</span>
            {copy.backToListening}
          </button>
          <span className="reader-window-title">{openListening.title}</span>
        </header>
        {transientMessages}
        <main className="focused-listening-layout">
          <ListeningWorkspace
            item={openListening}
            copy={copy}
            transcribing={transcribingListeningId === openListening.id}
            onTranscribe={() => void transcribeListening(openListening)}
            onSelectWord={selectWord}
            onError={(listeningError) => setError(errorMessage(listeningError, copy))}
          />
          <DefinitionPanel
            request={request}
            definition={definition}
            loading={loadingDefinition}
            isSaved={isSaved}
            copy={copy}
            emptyHelp={copy.listeningSelectWordHelp}
            sentencePlaybackSettings={null}
            sentenceAudioLoading={false}
            chineseHint={chineseHint}
            chineseHintVisible={chineseHintVisible}
            loadingChineseHint={loadingChineseHint}
            refiningDefinition={refiningDefinition}
            audioAttribution={audioAttribution}
            wordAudioLoading={wordAudioLoadingWord === request?.word.trim().toLowerCase()}
            canUseTextAi={runtimeStatus.textAiEnabled}
            onSpeak={() => undefined}
            onPlayWordAudio={() => void playSelectedWordAudio()}
            onRefineDefinition={refineSelectedDefinition}
            onToggleChineseHint={toggleChineseHint}
            onSave={saveSelectedWord}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header ref={topbarRef} className="topbar">
        <button
          className="brand"
          onClick={() => {
            setView('reading')
            setOpenArticleId(null)
            setOpenListeningId(null)
            clearDefinitionSelection()
          }}
        >
          <span>原</span>
          <div>
            <strong>{copy.brandName}</strong>
            <small>{copy.brandSecondary}</small>
          </div>
        </button>
        <nav aria-label={copy.primaryNavigation}>
          <button
            className={view === 'reading' ? 'active' : ''}
            onClick={() => {
              setView('reading')
              setOpenArticleId(null)
              setOpenListeningId(null)
              clearDefinitionSelection()
            }}
          >
            {copy.reading}
          </button>
          <button
            className={view === 'listening' ? 'active' : ''}
            onClick={() => {
              setView('listening')
              setOpenArticleId(null)
              setOpenListeningId(null)
              clearDefinitionSelection()
            }}
          >
            {copy.listening}
          </button>
          <button className={view === 'notebook' ? 'active' : ''} onClick={() => setView('notebook')}>
            {copy.notebook} <span>{state.savedWords.length}</span>
          </button>
        </nav>
        <div className="topbar-actions">
          <AiServiceStatusButton
            status={runtimeStatus}
            copy={copy}
            onClick={() => {
              setAiSettingsError(null)
              setAiSettingsOpen(true)
            }}
          />
          <div className="language-switch" role="group" aria-label={copy.languageControl}>
            <button
              className={state.uiLanguage === 'zh' ? 'active' : ''}
              aria-pressed={state.uiLanguage === 'zh'}
              onClick={() => switchLanguage('zh')}
            >
              中文
            </button>
            <button
              className={state.uiLanguage === 'en' ? 'active' : ''}
              aria-pressed={state.uiLanguage === 'en'}
              onClick={() => switchLanguage('en')}
            >
              EN
            </button>
          </div>
          {view === 'reading' ? (
            <button className="primary-button topbar-import" onClick={importArticle}>
              {copy.import}
            </button>
          ) : view === 'listening' ? (
            <button className="primary-button topbar-import" onClick={importListening}>
              {copy.import}
            </button>
          ) : null}
        </div>
      </header>

      {transientMessages}

      {view === 'reading' ? (
        <ArticleLibrary
          articles={state.articles}
          language={state.uiLanguage}
          copy={copy}
          onOpen={openReading}
          onRequestDelete={setPendingArticleDelete}
        />
      ) : view === 'listening' ? (
        <ListeningLibrary
          items={state.listeningItems}
          language={state.uiLanguage}
          copy={copy}
          onOpen={openListeningItem}
        />
      ) : (
        <Notebook
          words={state.savedWords}
          language={state.uiLanguage}
          copy={copy}
          sentencePlaybackSettings={sentencePlaybackSettings}
          sentenceAudioLoading={sentenceAudioLoadingText !== null}
          onPlayWordAudio={playDictionaryWordAudio}
          onSpeakSentence={(text) => void playSentence(text)}
          onDelete={deleteWord}
        />
      )}

      {pendingArticleDelete ? (
        <div className="confirm-backdrop" role="presentation">
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-article-title"
            aria-describedby="delete-article-description"
          >
            <span className="eyebrow">{copy.libraryTitle}</span>
            <h2 id="delete-article-title">{copy.deleteArticleTitle}</h2>
            <p id="delete-article-description">
              {copy.confirmDeleteArticle(toPlainArticleTitle(pendingArticleDelete.title))}
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="secondary-button"
                autoFocus
                disabled={deletingArticle}
                onClick={() => setPendingArticleDelete(null)}
              >
                {copy.cancelDeleteArticle}
              </button>
              <button
                type="button"
                className="confirm-delete-button"
                disabled={deletingArticle}
                onClick={() => void deleteArticle()}
              >
                {copy.deleteArticle}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {aiSettingsOpen ? (
        <AiServiceSettings
          status={runtimeStatus}
          copy={copy}
          onboarding={!runtimeStatus.aiOnboardingDismissed}
          topOffset={aiSettingsTop}
          saving={savingAiSettings}
          error={aiSettingsError}
          onSave={(input) => void saveAiServices(input)}
          onDisconnect={() => void disconnectAiServices()}
          onDismissOnboarding={() => void dismissAiOnboarding()}
          onClose={() => {
            setAiSettingsError(null)
            setAiSettingsOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}
