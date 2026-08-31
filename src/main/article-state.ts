import type { AppState } from '../shared/types'

export function deleteArticleFromState(state: AppState, articleId: string): AppState {
  if (!state.articles.some((article) => article.id === articleId)) return state

  return {
    ...state,
    articles: state.articles.filter((article) => article.id !== articleId),
    savedWords: state.savedWords.map((savedWord) =>
      savedWord.articleId === articleId ? { ...savedWord, articleId: null } : savedWord
    ),
    lookupEvents: state.lookupEvents.map((lookup) =>
      lookup.articleId === articleId ? { ...lookup, articleId: null } : lookup
    )
  }
}
