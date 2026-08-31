import type { DefinitionRequest, DefinitionResult } from '../../shared/types'

export interface DefinitionProvider {
  define(request: DefinitionRequest): Promise<DefinitionResult>
}
