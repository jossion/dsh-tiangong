/**
 * Token accounting for one delivery job.
 *
 * A delivery turn reports `usage` on every `assistant/message`; the host has
 * already paid for those tokens, so the board must know them. The plugin never
 * guesses a price: it keeps tokens as the machine evidence and multiplies by a
 * configured price only when the deployment provides one.
 */

export const DEFAULT_PRICE = {
  /** USD per 1M input tokens; 0 means "not configured, keep tokens only". */
  priceInputPerMTok: 0,
  /** USD per 1M output tokens. */
  priceOutputPerMTok: 0,
}

const round = value => Math.round(value * 1_000_000) / 1_000_000

export function totalTokens(usage) {
  if (usage === null || usage === undefined || typeof usage !== 'object') return 0
  return (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0)
}

/** Turn a configured price into USD; a price of 0 keeps the cost at 0. */
export function costOf(usage, price = DEFAULT_PRICE) {
  const input = Number(usage?.inputTokens) || 0
  const output = Number(usage?.outputTokens) || 0
  const inputPrice = Number(price?.priceInputPerMTok) || 0
  const outputPrice = Number(price?.priceOutputPerMTok) || 0
  return round((input * inputPrice + output * outputPrice) / 1_000_000)
}

/**
 * Fold one Session's assistant usage into totals. Persisted events are the
 * evidence; a message without a usage block contributes nothing.
 */
export function foldUsage(events) {
  let inputTokens = 0
  let outputTokens = 0
  let messages = 0
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type !== 'assistant/message') continue
    const usage = event?.data?.usage
    if (usage === null || usage === undefined || typeof usage !== 'object') continue
    messages += 1
    inputTokens += Number(usage.inputTokens) || 0
    outputTokens += Number(usage.outputTokens) || 0
  }
  return { inputTokens, outputTokens, messages }
}

/** One `usage` ledger line; totals are absolute so replay is idempotent. */
export function usageEvent({ projectId, jobId, usage, price = DEFAULT_PRICE, ts }) {
  if (typeof jobId !== 'string' || jobId === '') throw new Error('a usage event needs a jobId')
  const totals = {
    inputTokens: Number(usage?.inputTokens) || 0,
    outputTokens: Number(usage?.outputTokens) || 0,
  }
  return {
    kind: 'usage',
    projectId: projectId ?? null,
    jobId,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    totalTokens: totals.inputTokens + totals.outputTokens,
    costUsd: costOf(totals, price),
    ts: ts ?? new Date().toISOString(),
  }
}
