#!/usr/bin/env node
/**
 * 校验 Sentry 本地配置是否可用，并可选地端到端发一条测试事件。
 *
 * 本脚本永远不会打印 DSN 原文，只输出脱敏后的结构信息。
 *
 * 用法：
 *   node scripts/check-sentry-dsn.mjs            # 只做格式校验
 *   node scripts/check-sentry-dsn.mjs --send     # 额外向 Sentry 真实发送一条测试消息
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(repoRoot, '.env.sentry.local')

/** 只解析这一个文件，不引入任何依赖。 */
async function readEnvFile() {
  let raw
  try {
    raw = await readFile(envPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  const values = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

/**
 * 把 DSN 拆成可安全展示的部分：隐藏 public key，只保留区域与 project id。
 * @param {string} dsn
 */
function describeDsn(dsn) {
  let url
  try {
    url = new URL(dsn)
  } catch {
    return { ok: false, reason: 'DSN 不是合法 URL' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: `协议应为 https，实际为 ${url.protocol}` }
  }
  if (!url.username) {
    return { ok: false, reason: '缺少 public key（@ 之前的部分）' }
  }
  const projectId = url.pathname.replace(/^\//, '')
  if (!projectId) {
    return { ok: false, reason: '缺少 project id（路径部分）' }
  }
  const keyTail = url.username.slice(-4)
  return {
    ok: true,
    host: url.host,
    projectId,
    region: url.host.includes('.de.') ? 'EU' : url.host.includes('.us.') ? 'US' : '其他/自建',
    keyTail: `...${keyTail}`,
    keyLength: url.username.length
  }
}

/** 按 DSN 拼出 store 端点。 */
function envelopeUrl(dsn) {
  const url = new URL(dsn)
  const projectId = url.pathname.replace(/^\//, '')
  return `${url.protocol}//${url.host}/api/${projectId}/envelope/`
}

async function sendTestEvent(dsn) {
  const eventId = crypto.randomUUID().replace(/-/g, '')
  const envelope = [
    JSON.stringify({
      event_id: eventId,
      sent_at: new Date().toISOString(),
      dsn
    }),
    JSON.stringify({ type: 'event', content_type: 'application/json' }),
    JSON.stringify({
      event_id: eventId,
      level: 'info',
      message: 'sentry-dsn-check: 连接测试',
      platform: 'javascript',
      release: 'dsn-check',
      environment: 'dsn-check',
      tags: { probe: 'check-sentry-dsn.mjs' }
    })
  ].join('\n')

  const response = await fetch(envelopeUrl(dsn), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-sentry-envelope' },
    body: envelope
  })
  return { status: response.status, ok: response.ok, eventId }
}

const values = await readEnvFile()

if (values === null) {
  console.error('未找到 .env.sentry.local')
  console.error('请先执行：Copy-Item .env.sentry.local.example .env.sentry.local')
  process.exit(1)
}

const dsn = (values.SENTRY_DSN ?? '').trim()

if (!dsn) {
  console.error('.env.sentry.local 存在，但 SENTRY_DSN 还是空的。')
  console.error(`请打开 ${envPath} 并把 DSN 填在 SENTRY_DSN= 后面。`)
  process.exit(1)
}

const info = describeDsn(dsn)

if (!info.ok) {
  console.error(`SENTRY_DSN 格式不对：${info.reason}`)
  console.error('（未打印 DSN 原文。请核对是否复制完整、是否多了引号或空格。）')
  process.exit(1)
}

console.log('SENTRY_DSN 格式校验通过（已脱敏）：')
console.log(`  区域       : ${info.region}`)
console.log(`  上报主机   : ${info.host}`)
console.log(`  project id : ${info.projectId}`)
console.log(`  public key : ${info.keyTail}（共 ${info.keyLength} 字符）`)

if (values.SENTRY_ENVIRONMENT?.trim()) {
  console.log(`  environment: ${values.SENTRY_ENVIRONMENT.trim()}`)
} else {
  console.log('  environment: (未设置，运行时自动判断)')
}
if (values.SENTRY_RELEASE?.trim()) {
  console.log(`  release    : ${values.SENTRY_RELEASE.trim()}`)
} else {
  console.log('  release    : (未设置，用 package.json version)')
}

if (!process.argv.includes('--send')) {
  console.log('')
  console.log('下一步（可选）：加 --send 真实发一条测试事件，确认 DSN 可写。')
  process.exit(0)
}

console.log('')
console.log('正在发送测试事件 ...')
try {
  const result = await sendTestEvent(dsn)
  if (result.ok) {
    console.log(`发送成功（HTTP ${result.status}）。`)
    console.log(`event id: ${result.eventId}`)
    console.log('到 Sentry 的 Issues 列表应该能看到一条 level=info 的 "sentry-dsn-check: 连接测试"。')
  } else {
    console.error(`发送失败：HTTP ${result.status}`)
    console.error('常见原因：DSN 复制不完整、project 已删除、或 key 被禁用。')
    process.exit(1)
  }
} catch (error) {
  console.error(`发送时出错：${error?.message ?? error}`)
  process.exit(1)
}
