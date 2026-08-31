export const SENTENCE_PLAYBACK_RATES = [1, 0.9] as const
export type SentencePlaybackRate = (typeof SENTENCE_PLAYBACK_RATES)[number]

export function configureSentenceAudioPlayback(
  audio: Pick<HTMLAudioElement, 'playbackRate' | 'preservesPitch'>,
  rate: SentencePlaybackRate
): void {
  audio.preservesPitch = true
  audio.playbackRate = rate
}
