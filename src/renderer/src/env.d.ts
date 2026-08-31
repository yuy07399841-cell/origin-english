/// <reference types="vite/client" />

import type { OriginEnglishApi } from '../../shared/types'

declare global {
  interface Window {
    originEnglish: OriginEnglishApi
  }
}

export {}
