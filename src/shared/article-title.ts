export function toPlainArticleTitle(value: string): string {
  const plainTitle = value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[\*_~`]/g, '')
    .replace(/\\([\[\]()])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

  return plainTitle || 'Untitled reading'
}
