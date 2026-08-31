import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const LEDGER_VERSION = 1 as const
export const MIMO_ATTEMPT_RESERVATION_CNY = 0.02

export interface MiMoTokenUsage {
  promptTokens: number
  completionTokens: number
}

interface MiMoUsageLedger {
  version: typeof LEDGER_VERSION
  requestCount: number
  promptTokens: number
  completionTokens: number
  estimatedCostCny: number
  updatedAt: string | null
}

export interface MiMoBudgetStatus {
  limitCny: number
  requestCount: number
  promptTokens: number
  completionTokens: number
  estimatedCostCny: number
}

export interface MiMoBudgetReservation {
  settle: (usage?: MiMoTokenUsage) => Promise<void>
}

function emptyLedger(): MiMoUsageLedger {
  return {
    version: LEDGER_VERSION,
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostCny: 0,
    updatedAt: null
  }
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function parseLedger(value: unknown): MiMoUsageLedger {
  if (!value || typeof value !== 'object') {
    throw new Error('MiMo usage ledger is invalid. Live requests are blocked.')
  }
  const ledger = value as Partial<MiMoUsageLedger>
  if (
    ledger.version !== LEDGER_VERSION ||
    !Number.isInteger(ledger.requestCount) ||
    !isNonNegativeNumber(ledger.requestCount) ||
    !Number.isInteger(ledger.promptTokens) ||
    !isNonNegativeNumber(ledger.promptTokens) ||
    !Number.isInteger(ledger.completionTokens) ||
    !isNonNegativeNumber(ledger.completionTokens) ||
    !isNonNegativeNumber(ledger.estimatedCostCny) ||
    (ledger.updatedAt !== null && typeof ledger.updatedAt !== 'string')
  ) {
    throw new Error('MiMo usage ledger is invalid. Live requests are blocked.')
  }
  return ledger as MiMoUsageLedger
}

export function estimateMiMoCostCny(usage: MiMoTokenUsage): number {
  const inputCost = usage.promptTokens / 1_000_000
  const outputCost = (usage.completionTokens * 2) / 1_000_000
  return inputCost + outputCost
}

export class MiMoBudgetGuard {
  private queue: Promise<void> = Promise.resolve()
  private inFlightReservations = 0

  constructor(
    private readonly filePath: string,
    private readonly limitCny: number
  ) {
    if (!Number.isFinite(limitCny) || limitCny <= 0) {
      throw new Error('MiMo budget limit must be positive.')
    }
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    let release = (): void => undefined
    const previous = this.queue
    this.queue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private async readLedger(): Promise<MiMoUsageLedger> {
    try {
      return parseLedger(JSON.parse(await readFile(this.filePath, 'utf8')) as unknown)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyLedger()
      if (error instanceof SyntaxError) {
        throw new Error('MiMo usage ledger is invalid. Live requests are blocked.')
      }
      throw error
    }
  }

  private async writeLedger(ledger: MiMoUsageLedger): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.${process.pid}.tmp`
    await writeFile(tempPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
    await rename(tempPath, this.filePath)
  }

  async status(): Promise<MiMoBudgetStatus> {
    return this.exclusive(async () => {
      const ledger = await this.readLedger()
      return {
        limitCny: this.limitCny,
        requestCount: ledger.requestCount,
        promptTokens: ledger.promptTokens,
        completionTokens: ledger.completionTokens,
        estimatedCostCny: ledger.estimatedCostCny
      }
    })
  }

  async reserve(): Promise<MiMoBudgetReservation> {
    await this.exclusive(async () => {
      const ledger = await this.readLedger()
      const projected =
        ledger.estimatedCostCny +
        (this.inFlightReservations + 1) * MIMO_ATTEMPT_RESERVATION_CNY
      if (projected > this.limitCny) {
        throw new Error('The ¥5 MiMo budget limit has been reached. Live lookup is paused.')
      }
      this.inFlightReservations += 1
    })

    let settled = false
    return {
      settle: async (usage?: MiMoTokenUsage): Promise<void> => {
        if (settled) return
        settled = true
        await this.exclusive(async () => {
          this.inFlightReservations = Math.max(0, this.inFlightReservations - 1)
          const ledger = await this.readLedger()
          const hasUsage =
            usage !== undefined &&
            Number.isInteger(usage.promptTokens) &&
            usage.promptTokens >= 0 &&
            Number.isInteger(usage.completionTokens) &&
            usage.completionTokens >= 0
          const promptTokens = hasUsage ? usage.promptTokens : 0
          const completionTokens = hasUsage ? usage.completionTokens : 0
          const estimatedCost = hasUsage
            ? estimateMiMoCostCny({ promptTokens, completionTokens })
            : MIMO_ATTEMPT_RESERVATION_CNY
          await this.writeLedger({
            version: LEDGER_VERSION,
            requestCount: ledger.requestCount + 1,
            promptTokens: ledger.promptTokens + promptTokens,
            completionTokens: ledger.completionTokens + completionTokens,
            estimatedCostCny: Number((ledger.estimatedCostCny + estimatedCost).toFixed(8)),
            updatedAt: new Date().toISOString()
          })
        })
      }
    }
  }
}
