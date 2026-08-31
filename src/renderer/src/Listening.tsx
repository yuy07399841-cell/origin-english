import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  DefinitionRequest,
  ListeningItem,
  ListeningSentence,
  UiLanguage
} from '../../shared/types'
import { getDefinitionRequestFromSelection } from './selection'
import type { UiCopy } from './i18n'
import {
  clampSeekTime,
  formatPlaybackTime,
  getListeningShortcutAction,
  LISTENING_PLAYBACK_RATES,
  resolveActiveSentenceId,
  type ListeningPlaybackRate
} from './listening-player'

function PlayIcon(): React.JSX.Element {
  return (
    <svg className="player-control-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.7v12.6a1 1 0 0 0 1.54.84l8.75-6.3a1 1 0 0 0 0-1.68L9.54 4.86A1 1 0 0 0 8 5.7Z" />
    </svg>
  )
}

function PauseIcon(): React.JSX.Element {
  return (
    <svg className="player-control-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="5" width="4" height="14" rx="1" />
      <rect x="13.5" y="5" width="4" height="14" rx="1" />
    </svg>
  )
}

function SeekTenLabel({ direction }: { direction: 'backward' | 'forward' }): React.JSX.Element {
  return (
    <span className="seek-ten-label" aria-hidden="true">
      {direction === 'backward' ? '−10' : '+10'}
    </span>
  )
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  return target instanceof HTMLInputElement && target.type !== 'range'
}

interface ListeningLibraryProps {
  items: ListeningItem[]
  language: UiLanguage
  copy: UiCopy
  onOpen: (id: string) => void
}

export function ListeningLibrary({
  items,
  language,
  copy,
  onOpen
}: ListeningLibraryProps): React.JSX.Element {
  const locale = language === 'zh' ? 'zh-CN' : 'en-US'
  return (
    <main className="library-page listening-library-page">
      <header className="library-heading">
        <div>
          <span className="eyebrow">{copy.listeningLibraryEyebrow}</span>
          <h1>{copy.listeningLibraryTitle}</h1>
          <p>{copy.listeningLibraryBody}</p>
        </div>
        <span>{copy.audioCount(items.length)}</span>
      </header>

      {items.length ? (
        <section className="article-list" aria-label={copy.audioListLabel}>
          {items.map((item) => (
            <article className="article-row listening-row" key={item.id}>
              <button
                type="button"
                className="article-open-button"
                aria-label={`${copy.openListening}: ${item.title}`}
                onClick={() => onOpen(item.id)}
              >
                <span className="article-monogram listening-monogram" aria-hidden="true">
                  ♪
                </span>
                <span className="article-row-copy">
                  <strong>{item.title}</strong>
                  <span>{item.fileName}</span>
                </span>
                <span className={item.transcript ? 'transcript-status ready' : 'transcript-status'}>
                  {item.transcript
                    ? copy.sentenceCount(item.transcript.sentences.length)
                    : copy.notTranscribed}
                </span>
                <time>{copy.importedOn(new Date(item.importedAt).toLocaleDateString(locale))}</time>
                <span className="article-open" aria-hidden="true">›</span>
              </button>
            </article>
          ))}
        </section>
      ) : (
        <section className="empty-library">
          <div className="empty-symbol">♪</div>
          <h2>{copy.emptyListeningTitle}</h2>
          <p>{copy.emptyListeningBody}</p>
          <small>{copy.audioFileSupport}</small>
        </section>
      )}
    </main>
  )
}

interface ListeningWorkspaceProps {
  item: ListeningItem
  copy: UiCopy
  transcribing: boolean
  onTranscribe: () => void
  onSelectWord: (request: DefinitionRequest) => void
  onError: (error: unknown) => void
}

export function ListeningWorkspace({
  item,
  copy,
  transcribing,
  onTranscribe,
  onSelectWord,
  onError
}: ListeningWorkspaceProps): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const transcriptRef = useRef<HTMLElement>(null)
  const sentenceEndRef = useRef<number | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const [audioSource, setAudioSource] = useState<string | null>(null)
  const [audioLoading, setAudioLoading] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [currentMs, setCurrentMs] = useState(0)
  const [durationMs, setDurationMs] = useState(item.transcript?.durationMs ?? 0)
  const [rate, setRate] = useState<ListeningPlaybackRate>(1)
  const [transcriptVisible, setTranscriptVisible] = useState(false)
  const [playedSentenceId, setPlayedSentenceId] = useState<string | null>(null)
  const sentences = item.transcript?.sentences ?? []
  const activeSentenceId = useMemo(
    () => resolveActiveSentenceId(sentences, currentMs, playedSentenceId),
    [currentMs, playedSentenceId, sentences]
  )

  useEffect(() => {
    let cancelled = false
    setAudioLoading(true)
    setAudioSource(null)
    window.originEnglish
      .getListeningAudio(item.id)
      .then((result) => {
        if (!cancelled) setAudioSource(result.dataUrl)
      })
      .catch((error: unknown) => {
        if (!cancelled) onError(error)
      })
      .finally(() => {
        if (!cancelled) setAudioLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [item.id])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.playbackRate = rate
  }, [rate])

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      audioRef.current?.pause()
    },
    []
  )

  const cancelSentenceMonitor = (): void => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }

  const leaveSentencePlayback = (): void => {
    cancelSentenceMonitor()
    sentenceEndRef.current = null
    setPlayedSentenceId(null)
  }

  const monitorSentenceEnd = (): void => {
    const audio = audioRef.current
    const endMs = sentenceEndRef.current
    if (!audio || endMs === null || audio.paused) {
      animationFrameRef.current = null
      return
    }
    if (audio.currentTime * 1000 >= endMs - 12) {
      audio.pause()
      audio.currentTime = endMs / 1000
      sentenceEndRef.current = null
      animationFrameRef.current = null
      setCurrentMs(endMs)
      return
    }
    animationFrameRef.current = window.requestAnimationFrame(monitorSentenceEnd)
  }

  const togglePlayback = async (): Promise<void> => {
    const audio = audioRef.current
    if (!audio || !audioSource) return
    if (audio.paused) {
      if (sentenceEndRef.current === null) setPlayedSentenceId(null)
      try {
        await audio.play()
        if (sentenceEndRef.current !== null) {
          cancelSentenceMonitor()
          animationFrameRef.current = window.requestAnimationFrame(monitorSentenceEnd)
        }
      } catch (error) {
        onError(error)
      }
    } else {
      cancelSentenceMonitor()
      audio.pause()
    }
  }

  const seekBy = (deltaMs: number): void => {
    const audio = audioRef.current
    if (!audio) return
    leaveSentencePlayback()
    const next = clampSeekTime(audio.currentTime * 1000, deltaMs, durationMs)
    audio.currentTime = next / 1000
    setCurrentMs(next)
  }

  const playSentence = async (sentence: ListeningSentence): Promise<void> => {
    const audio = audioRef.current
    if (!audio || !audioSource) return
    cancelSentenceMonitor()
    sentenceEndRef.current = sentence.endMs
    setPlayedSentenceId(sentence.id)
    audio.currentTime = sentence.startMs / 1000
    setCurrentMs(sentence.startMs)
    try {
      await audio.play()
      animationFrameRef.current = window.requestAnimationFrame(monitorSentenceEnd)
    } catch (error) {
      sentenceEndRef.current = null
      setPlayedSentenceId(null)
      onError(error)
    }
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || isTextEntryTarget(event.target)) return
      const action = getListeningShortcutAction(event)
      if (!action) return
      event.preventDefault()
      if (action === 'toggle-playback') {
        void togglePlayback()
      } else {
        seekBy(action === 'seek-backward' ? -10_000 : 10_000)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [audioSource, durationMs])

  const selectTranscriptWord = (): void => {
    if (!transcriptRef.current) return
    const request = getDefinitionRequestFromSelection(
      transcriptRef.current,
      window.getSelection()
    )
    if (request) onSelectWord(request)
  }

  return (
    <section className="listening-workspace">
      <div className="listening-player-card">
        <div className="listening-player-heading">
          <div>
            <span className="eyebrow">{copy.nowListening}</span>
            <h1>{item.title}</h1>
            <p>{item.fileName}</p>
          </div>
          <button
            type="button"
            className="secondary-button transcript-toggle"
            disabled={transcribing}
            onClick={() => {
              if (!item.transcript) onTranscribe()
              else setTranscriptVisible((visible) => !visible)
            }}
          >
            {transcribing
              ? copy.transcribing
              : !item.transcript
                ? copy.createTranscript
                : transcriptVisible
                  ? copy.hideTranscript
                  : copy.showTranscript}
          </button>
        </div>

        {audioLoading ? (
          <div className="audio-loading">{copy.loadingAudio}</div>
        ) : (
          <>
            <audio
              ref={audioRef}
              src={audioSource ?? undefined}
              preload="metadata"
              onLoadedMetadata={(event) =>
                setDurationMs(Math.round(event.currentTarget.duration * 1000))
              }
              onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                setPlaying(false)
                leaveSentencePlayback()
              }}
            />
            <div className="player-controls">
              <button
                type="button"
                className="seek-control"
                onClick={() => seekBy(-10_000)}
                aria-label={copy.backTenSeconds}
                title={copy.backTenSeconds}
              >
                <SeekTenLabel direction="backward" />
              </button>
              <button
                type="button"
                className="play-toggle"
                onClick={() => void togglePlayback()}
                disabled={!audioSource}
                aria-label={playing ? copy.pause : copy.play}
                aria-pressed={playing}
                title={playing ? copy.pause : copy.play}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button
                type="button"
                className="seek-control"
                onClick={() => seekBy(10_000)}
                aria-label={copy.forwardTenSeconds}
                title={copy.forwardTenSeconds}
              >
                <SeekTenLabel direction="forward" />
              </button>
            </div>
            <div className="listening-progress">
              <input
                type="range"
                min={0}
                max={Math.max(1, durationMs)}
                value={Math.min(currentMs, Math.max(1, durationMs))}
                aria-label={copy.audioProgress}
                onChange={(event) => {
                  const audio = audioRef.current
                  if (!audio) return
                  leaveSentencePlayback()
                  const next = Number(event.target.value)
                  audio.currentTime = next / 1000
                  setCurrentMs(next)
                }}
              />
              <div>
                <span>{formatPlaybackTime(currentMs)}</span>
                <span>{formatPlaybackTime(durationMs)}</span>
              </div>
            </div>
            <div className="listening-rate" role="group" aria-label={copy.playbackSpeed}>
              <span>{copy.playbackSpeed}</span>
              <div>
                {LISTENING_PLAYBACK_RATES.map((playbackRate) => (
                  <button
                    type="button"
                    key={playbackRate}
                    className={rate === playbackRate ? 'active' : ''}
                    aria-pressed={rate === playbackRate}
                    onClick={() => setRate(playbackRate)}
                  >
                    {playbackRate}×
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {!item.transcript ? (
          <p className="transcription-note">{copy.transcriptionNote}</p>
        ) : null}
      </div>

      {item.transcript && transcriptVisible ? (
        <section
          ref={transcriptRef}
          className="transcript-panel"
          aria-label={copy.transcript}
          onMouseUp={selectTranscriptWord}
        >
          <header>
            <div>
              <span className="eyebrow">{copy.transcript}</span>
              <h2 className="sentence-count">
                <span className="sentence-count-number">{sentences.length}</span>
                <span className="sentence-count-unit">
                  {copy.sentenceCountUnit(sentences.length)}
                </span>
              </h2>
            </div>
            <p>{copy.transcriptSelectionHelp}</p>
          </header>
          <div className="sentence-list">
            {sentences.map((sentence, index) => (
              <article
                className={activeSentenceId === sentence.id ? 'sentence-row active' : 'sentence-row'}
                key={sentence.id}
              >
                <button
                  type="button"
                  className="sentence-play-button"
                  aria-label={`${copy.playSentence} ${index + 1}`}
                  onClick={() => void playSentence(sentence)}
                >
                  ▶
                </button>
                <time>{formatPlaybackTime(sentence.startMs)}</time>
                <p>{sentence.text}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  )
}
