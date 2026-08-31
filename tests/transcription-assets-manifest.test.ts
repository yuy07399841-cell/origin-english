import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  SMALL_EN_MODEL_SHA256,
  WHISPER_RUNTIME_SHA256
} from '../src/main/listening-transcription'

interface TranscriptionManifest {
  model: {
    bytes: number
    sha256: string
    sourceRevision: string
    sourceUrl: string
  }
  runtime: {
    build: string
    files: Array<{ name: string; sha256: string }>
  }
}

const manifest = JSON.parse(
  readFileSync(new URL('../resources/transcription-assets.json', import.meta.url), 'utf8')
) as TranscriptionManifest

describe('transcription asset manifest', () => {
  it('pins the product Small.EN model by size, revision, and SHA-256', () => {
    expect(manifest.model).toMatchObject({
      bytes: 487_614_201,
      sha256: SMALL_EN_MODEL_SHA256,
      sourceRevision: 'c521a4b02f422512d734391fdf08bb08c0862f68'
    })
    expect(manifest.model.sourceUrl).toContain(manifest.model.sourceRevision)
  })

  it('matches every runtime hash enforced by the application', () => {
    expect(manifest.runtime.build).toBe('b4938')
    expect(Object.fromEntries(manifest.runtime.files.map((file) => [file.name, file.sha256]))).toEqual(
      WHISPER_RUNTIME_SHA256
    )
  })
})
