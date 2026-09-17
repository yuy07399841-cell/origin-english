// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DefinitionPanel } from '../src/renderer/src/App'
import { UI_COPY } from '../src/renderer/src/i18n'

afterEach(cleanup)

const baseProps = {
  request: { word: 'notice', sentence: 'I noticed a small change.' },
  loading: false,
  isSaved: false,
  copy: UI_COPY.en,
  sentencePlaybackSettings: null,
  sentenceAudioLoading: false,
  chineseHint: null,
  chineseHintVisible: false,
  loadingChineseHint: false,
  refiningDefinition: false,
  audioAttribution: null,
  wordAudioLoading: false,
  canUseTextAi: true,
  onSpeak: vi.fn(),
  onPlayWordAudio: vi.fn(),
  onRefineDefinition: vi.fn(),
  onToggleChineseHint: vi.fn(),
  onSave: vi.fn()
}

describe('definition card interactions', () => {
  it('shows only the first dictionary sense until the learner expands the rest', async () => {
    const user = userEvent.setup()
    render(<DefinitionPanel {...baseProps} definition={{
      word: 'notice', partOfSpeech: 'verb', definition: 'to become aware', usage: '',
      contextualChineseHint: null, source: 'simple-wiktionary', notice: 'local', phonetic: null,
      hasAudio: false, hasAlternativeSenses: true, hasChineseReference: false, sourceUrl: null,
      senses: [
        { partOfSpeech: 'verb', definition: 'to become aware', usage: '' },
        { partOfSpeech: 'noun', definition: 'a written warning', usage: '' }
      ]
    }} />)
    expect(screen.queryByText('a written warning')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show other dictionary senses' }))
    expect(screen.getByText('a written warning')).toBeTruthy()
  })

  it('collapses other senses when the learner selects another word', async () => {
    const definition = {
      word: 'notice', partOfSpeech: 'verb', definition: 'to become aware', usage: '',
      contextualChineseHint: null, source: 'simple-wiktionary' as const, notice: 'local', phonetic: null,
      hasAudio: false, hasAlternativeSenses: true, hasChineseReference: false, sourceUrl: null,
      senses: [{ partOfSpeech: 'verb', definition: 'to become aware', usage: '' },
        { partOfSpeech: 'noun', definition: 'a written warning', usage: '' }]
    }
    const user = userEvent.setup()
    const { rerender } = render(<DefinitionPanel {...baseProps} definition={definition} />)
    await user.click(screen.getByRole('button', { name: 'Show other dictionary senses' }))
    rerender(<DefinitionPanel {...baseProps} request={{ word: 'bank', sentence: 'The river bank.' }}
      definition={{ ...definition, word: 'bank', senses: [definition.senses[0],
        { partOfSpeech: 'noun', definition: 'the land beside a river', usage: '' }] }} />)
    expect(screen.queryByText('the land beside a river')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show other dictionary senses' }))
    expect(screen.getByText('the land beside a river')).toBeTruthy()
  })

  it('offers AI only as an explicit action after a local miss', async () => {
    const onRefineDefinition = vi.fn()
    const user = userEvent.setup()
    render(<DefinitionPanel {...baseProps} onRefineDefinition={onRefineDefinition} definition={{
      word: 'unlisted', partOfSpeech: '', definition: '', usage: '', contextualChineseHint: null,
      source: 'not-found', notice: 'not found', phonetic: null, hasAudio: false,
      hasAlternativeSenses: false, hasChineseReference: false, sourceUrl: null, senses: []
    }} />)
    expect(onRefineDefinition).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Use text AI to explain this word' }))
    expect(onRefineDefinition).toHaveBeenCalledOnce()
  })
})
