import { useState } from 'react'
import type { UiLanguage, VideoImportProgress } from '../../shared/types'

export type UrlImportKind = 'article' | 'audio' | 'video'

interface ImportSourceDialogProps {
  kind: 'reading' | 'listening'
  language: UiLanguage
  busy: boolean
  progress?: VideoImportProgress | null
  onClose: () => void
  onLocal: () => void
  onUrl: (kind: UrlImportKind, url: string) => void
}

export function ImportSourceDialog({
  kind,
  language,
  busy,
  progress = null,
  onClose,
  onLocal,
  onUrl
}: ImportSourceDialogProps): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [sourceKind, setSourceKind] = useState<UrlImportKind>(kind === 'reading' ? 'article' : 'audio')
  const zh = language === 'zh'
  const title = kind === 'reading' ? (zh ? '导入文章' : 'Import article') : (zh ? '导入听力材料' : 'Import listening material')
  const urlLabel = kind === 'reading' ? (zh ? '公开文章网址' : 'Public article URL') : (zh ? '公开音频或视频网址' : 'Public audio or video URL')

  return (
    <div className="confirm-backdrop" role="presentation">
      <section className="confirm-dialog import-source-dialog" role="dialog" aria-modal="true" aria-labelledby="import-source-title">
        <span className="eyebrow">{zh ? '本地学习材料' : 'Local learning material'}</span>
        <h2 id="import-source-title">{title}</h2>
        <button type="button" className="secondary-button wide" disabled={busy} onClick={onLocal}>
          {kind === 'reading' ? (zh ? '选择本地 Markdown' : 'Choose local Markdown') : (zh ? '选择本地 MP3 / WAV' : 'Choose local MP3 / WAV')}
        </button>
        <div className="import-divider"><span>{zh ? '或者' : 'or'}</span></div>
        {kind === 'listening' ? (
          <div className="import-kind" role="group" aria-label={zh ? '网址类型' : 'URL type'}>
            <button type="button" className={sourceKind === 'audio' ? 'active' : ''} aria-pressed={sourceKind === 'audio'} onClick={() => setSourceKind('audio')}>
              {zh ? '音频直链' : 'Direct audio'}
            </button>
            <button type="button" className={sourceKind === 'video' ? 'active' : ''} aria-pressed={sourceKind === 'video'} onClick={() => setSourceKind('video')}>
              {zh ? '支持的视频网页' : 'Supported video page'}
            </button>
          </div>
        ) : null}
        {kind === 'listening' && sourceKind === 'video' ? (
          <div className="video-component-notice" aria-live="polite">
            <p>{zh
              ? '首次导入视频时会联网下载并校验所需组件，以后将复用本机副本。'
              : 'The first video import downloads verified components. Later imports reuse the local copy.'}</p>
            {progress ? (
              <div className="video-component-progress">
                <strong>{progress.message}</strong>
                {typeof progress.downloadedBytes === 'number' ? (
                  <span>{formatBytes(progress.downloadedBytes, zh)}{typeof progress.totalBytes === 'number'
                    ? ` ${zh ? '/' : 'of'} ${formatBytes(progress.totalBytes, zh)}`
                    : ''}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <form onSubmit={(event) => {
          event.preventDefault()
          const normalized = url.trim()
          if (normalized) onUrl(sourceKind, normalized)
        }}>
          <label>
            <span>{urlLabel}</span>
            <input type="url" required value={url} disabled={busy} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" />
          </label>
          <div className="confirm-actions">
            <button type="button" className="secondary-button" disabled={busy && !progress} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button>
            <button type="submit" className="primary-button" disabled={busy}>{busy ? (zh ? '正在导入…' : 'Importing…') : (zh ? '从网址导入' : 'Import from URL')}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function formatBytes(bytes: number, zh: boolean): string {
  if (bytes < 1024) return `${bytes} B`
  const kib = Math.round(bytes / 1024)
  return `${kib} ${zh ? 'KB' : 'KB'}`
}
