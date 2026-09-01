import type { AppState } from '../shared/types'

export function deleteListeningItemFromState(state: AppState, listeningId: string): AppState {
  if (!state.listeningItems.some((item) => item.id === listeningId)) return state

  return {
    ...state,
    listeningItems: state.listeningItems.filter((item) => item.id !== listeningId)
  }
}
