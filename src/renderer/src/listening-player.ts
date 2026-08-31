import type { ListeningSentence } from '../../shared/types'

export const LISTENING_PLAYBACK_RATES = [0.75, 1, 1.25] as const
export type ListeningPlaybackRate = (typeof LISTENING_PLAYBACK_RATES)[number]
export type ListeningShortcutAction =
  | 'toggle-playback'
  | 'seek-backward'
  | 'seek-forward'

export interface ListeningShortcutInput {
  key: string
  code?: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  repeat?: boolean
}

export function formatPlaybackTime(milliseconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function clampSeekTime(
  currentMilliseconds: number,
  deltaMilliseconds: number,
  durationMilliseconds: number
): number {
  return Math.min(
    Math.max(0, durationMilliseconds),
    Math.max(0, currentMilliseconds + deltaMilliseconds)
  )
}

export function findActiveSentenceId(
  sentences: ListeningSentence[],
  currentMilliseconds: number
): string | null {
  return (
    sentences.find(
      (sentence) =>
        currentMilliseconds >= sentence.startMs && currentMilliseconds < sentence.endMs
    )?.id ?? null
  )
}

export function resolveActiveSentenceId(
  sentences: ListeningSentence[],
  currentMilliseconds: number,
  selectedSentenceId: string | null
): string | null {
  if (selectedSentenceId && sentences.some((sentence) => sentence.id === selectedSentenceId)) {
    return selectedSentenceId
  }
  return findActiveSentenceId(sentences, currentMilliseconds)
}

export function getListeningShortcutAction({
  key,
  code,
  altKey = false,
  ctrlKey = false,
  metaKey = false,
  repeat = false
}: ListeningShortcutInput): ListeningShortcutAction | null {
  if (altKey || ctrlKey || metaKey) return null
  if (key === 'ArrowLeft') return 'seek-backward'
  if (key === 'ArrowRight') return 'seek-forward'
  if (key === ' ' || key === 'Spacebar' || code === 'Space') {
    return repeat ? null : 'toggle-playback'
  }
  return null
}
