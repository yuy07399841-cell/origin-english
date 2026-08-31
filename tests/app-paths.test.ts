import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ORIGIN_ENGLISH_APP_ID,
  resolveOriginEnglishUserDataPath
} from '../src/main/app-paths'

describe('stable desktop application paths', () => {
  it('keeps development and installed builds on the same user-data root', () => {
    expect(resolveOriginEnglishUserDataPath('C:\\Users\\reader\\AppData\\Roaming')).toBe(
      'C:\\Users\\reader\\AppData\\Roaming\\origin-english'
    )
    expect(ORIGIN_ENGLISH_APP_ID).toBe('com.originenglish.desktop')
  })

  it('preserves the explicit isolated validation override', () => {
    const isolatedPath = 'D:\\temporary\\origin-english-validation'
    expect(
      resolveOriginEnglishUserDataPath('C:\\Users\\reader\\AppData\\Roaming', isolatedPath)
    ).toBe(resolve(isolatedPath))
  })
})
