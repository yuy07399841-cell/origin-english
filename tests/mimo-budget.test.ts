import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  estimateMiMoCostCny,
  MIMO_ATTEMPT_RESERVATION_CNY,
  MiMoBudgetGuard
} from '../src/main/mimo-budget'

describe('MiMo budget guard', () => {
  it('uses the conservative non-cache token prices', () => {
    expect(estimateMiMoCostCny({ promptTokens: 1_000_000, completionTokens: 1_000_000 })).toBe(3)
  })

  it('persists only usage totals after a successful request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-english-budget-'))
    const filePath = join(directory, 'mimo-usage.json')
    try {
      const guard = new MiMoBudgetGuard(filePath, 5)
      const reservation = await guard.reserve()
      await reservation.settle({ promptTokens: 120, completionTokens: 45 })

      const status = await guard.status()
      expect(status.requestCount).toBe(1)
      expect(status.estimatedCostCny).toBe(0.00021)
      const fileContent = await readFile(filePath, 'utf8')
      expect(fileContent).not.toContain('context')
      expect(fileContent).not.toContain('sentence')
      expect(fileContent).not.toContain('api')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('charges the reservation after a failed or unmetered attempt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-english-budget-'))
    try {
      const guard = new MiMoBudgetGuard(join(directory, 'mimo-usage.json'), 5)
      const reservation = await guard.reserve()
      await reservation.settle()
      expect((await guard.status()).estimatedCostCny).toBe(MIMO_ATTEMPT_RESERVATION_CNY)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('blocks the next attempt when its reservation would exceed the limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'origin-english-budget-'))
    try {
      const guard = new MiMoBudgetGuard(
        join(directory, 'mimo-usage.json'),
        MIMO_ATTEMPT_RESERVATION_CNY
      )
      const first = await guard.reserve()
      await first.settle()
      await expect(guard.reserve()).rejects.toThrow('budget limit')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
