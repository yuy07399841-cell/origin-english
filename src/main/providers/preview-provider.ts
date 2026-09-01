import type { DefinitionRequest, DefinitionResult } from '../../shared/types'
import type { DefinitionProvider } from './definition-provider'

const previews: Record<
  string,
  Pick<DefinitionResult, 'partOfSpeech' | 'definition' | 'usage'>
> = {
  context: {
    partOfSpeech: 'noun',
    definition: 'the situation or surrounding information that helps an idea become clear',
    usage: 'The surrounding sentence gives context for the selected word.'
  },
  subtle: {
    partOfSpeech: 'adjective',
    definition: 'not obvious at first, but still important or noticeable with attention',
    usage: 'A subtle change may be easy to miss during a quick reading.'
  },
  sustain: {
    partOfSpeech: 'verb',
    definition: 'to keep something continuing over a period of time',
    usage: 'A comfortable layout helps sustain attention while reading.'
  },
  sustained: {
    partOfSpeech: 'verb',
    definition: 'kept continuing at a steady level or for a period of time',
    usage: 'Sustained attention makes it easier to notice a pattern.'
  },
  approach: {
    partOfSpeech: 'noun',
    definition: 'a way of dealing with a task or problem',
    usage: 'This reading approach keeps the explanation beside the article.'
  },
  practice: {
    partOfSpeech: 'noun',
    definition: 'regular activity done to improve a skill',
    usage: 'Daily reading practice gradually builds confidence.'
  }
}

export class PreviewDefinitionProvider implements DefinitionProvider {
  async define(request: DefinitionRequest): Promise<DefinitionResult> {
    const key = request.word.toLowerCase()
    const preview = previews[key] ?? {
      partOfSpeech: 'word',
      definition: `“${request.word}” is the selected word in this sentence. This local preview confirms the reading flow but does not attempt a model-generated sense.`,
      usage: 'Use the surrounding sentence to check the intended sense before a live provider is enabled.'
    }

    return {
      word: request.word,
      ...preview,
      contextualChineseHint: null,
      source: 'preview',
      notice: 'No local dictionary entry · No remote AI service was called',
      phonetic: null,
      hasAudio: false,
      hasAlternativeSenses: false,
      hasChineseReference: false,
      sourceUrl: null
    }
  }
}
