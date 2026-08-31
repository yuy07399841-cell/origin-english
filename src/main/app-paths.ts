import { join, resolve } from 'node:path'

export const ORIGIN_ENGLISH_APP_ID = 'com.originenglish.desktop'

export function resolveOriginEnglishUserDataPath(
  appDataPath: string,
  override?: string
): string {
  const explicitPath = override?.trim()
  return explicitPath ? resolve(explicitPath) : join(appDataPath, 'origin-english')
}
