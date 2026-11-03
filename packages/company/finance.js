/**
 * Finance: bank-statement files (CSV or Excel) in, interactive dashboard out.
 *
 * The requirement is deliberately narrow: a directory of bank statements is the
 * only source, and the dashboard must be filterable by category and by period.
 * Excel is the format the statements actually arrive in, so CSV is the simple
 * path and `.xlsx` is read by the zero-dependency reader in `excel.js`.
 * Everything here is a pure function of (file text) or (transaction list), so
 * the parser and the aggregates are testable without a browser or a model.
 *
 * Layout of the data:
 *
 *   file (bytes) -> decode -> rows -> header mapping -> transactions
 *   transactions -> filter (period / category / direction / search) -> summary
 *
 * A transaction keeps the amount positive and carries `direction`, because a
 * dashboard that sums signed numbers prints "收入 12,000 / 支出 -8,000" in one
 * column and the eye has to do the arithmetic. The sign is derived on render.
 */
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { workbookKind, xlsxSheets } from './excel.js'

/** Where the panel looks for statements until the owner points it elsewhere. */
export const DEFAULT_FINANCE_DIR = join(homedir(), 'Documents', '银行流水')

/** Header patterns, longest first so `交易金额` beats `金额`. */
const COLUMN_PATTERNS = {
  date: ['交易日期', '交易时间', '记账日期', '入账日期', '记账时间', '日期', 'date', 'time'],
  direction: ['收支标志', '收付标志', '借贷标志', '收支方向', '借贷方向', '收支', '方向', 'type', 'direction'],
  // Direction-specific columns are claimed before the generic amount column:
  // otherwise `借方金额` becomes "amount" and the sign is guessed wrongly.
  income: ['收入金额', '贷方金额', '贷方发生额', '存入金额', '收入'],
  expense: ['支出金额', '借方金额', '借方发生额', '支取金额', '支出'],
  amount: ['交易金额', '发生额', '收支金额', '金额', '交易额', 'amount'],
  description: ['交易摘要', '摘要', '交易用途', '用途', '备注', '说明', 'description', 'memo', 'detail'],
  counterparty: ['对方户名', '对方名称', '对方账户名', '交易对手', '收款人', '付款人', '对手方', 'counterparty', 'payee', 'payer'],
  balance: ['账户余额', '余额', 'balance'],
  category: ['交易分类', '分类', '类别', '类型', 'category'],
}

/** Ordered keyword rules. First match wins; order is the policy. */
const CATEGORY_RULES = [
  [/工资|薪资|薪酬|奖金|劳务|报酬|薪金/, '工资薪酬'],
  [/房租|租金|物业|公寓|宿舍/, '房租物业'],
  [/水费|电费|燃气|宽带|话费|电信|移动|联通|水电/, '水电通讯'],
  [/餐饮|美团|饿了么|外卖|餐厅|饭店|咖啡|奶茶|食堂/, '餐饮'],
  [/地铁|公交|滴滴|出租|打车|加油|停车|高速|高铁|机票|火车|交通/, '交通'],
  [/采购|货款|供应商|材料|原料|备件/, '采购货款'],
  [/税|社保|公积金|医保|个税/, '税费社保'],
  [/利息|结息|理财|基金|分红|国债|存款/, '利息理财'],
  [/退款|退货|冲正|撤销/, '退款'],
  [/报销|差旅|招待/, '报销'],
  [/医院|药|医疗|诊所|体检/, '医疗'],
  [/学费|培训|教育|课程|书籍/, '教育'],
  [/房租|物业费/, '房租物业'],
  [/转账|汇款|转入|转出|内部/, '转账'],
  [/保险/, '保险'],
  [/捐赠|公益/, '捐赠'],
]

/** Normalise one header cell for matching: BOM, spaces and case all go. */
function normaliseHeader(cell) {
  return String(cell ?? '').replace(/^\uFEFF/, '').replace(/\s+/g, '').toLowerCase()
}

/**
 * Decode a CSV buffer. Bank exports are not consistent: some are UTF-8, older
 * Chinese statements are GBK. Try UTF-8 strictly first; only fall back when it
 * is actually invalid, so a valid UTF-8 file is never mangled into GBK.
 */
export function decodeCsv(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (!utf8.includes('\uFFFD')) return { text: utf8.replace(/^\uFEFF/, ''), encoding: 'utf-8' }
  for (const encoding of ['gbk', 'gb18030']) {
    try {
      const text = new TextDecoder(encoding, { fatal: false }).decode(bytes)
      if (text !== '' && !text.includes('\uFFFD')) return { text, encoding }
    } catch {
      /* this runtime was built without the encoding; try the next one */
    }
  }
  return { text: utf8, encoding: 'utf-8-lossy' }
}

/** Pick the delimiter that splits the first few lines most evenly. */
export function detectDelimiter(text) {
  const sample = String(text ?? '').split(/\r?\n/).filter(line => line.trim() !== '').slice(0, 5)
  if (sample.length === 0) return ','
  const candidates = [',', '\t', ';', '|']
  let best = ','
  let bestScore = -1
  for (const delimiter of candidates) {
    const counts = sample.map(line => line.split(delimiter).length)
    const score = Math.min(...counts)
    if (score > bestScore) {
      best = delimiter
      bestScore = score
    }
  }
  return best
}

/**
 * RFC 4180 rows: quotes protect delimiters and newlines, `""` is one quote.
 * Done by hand instead of a dependency because the file set is small and the
 * project rule is "no new packages".
 */
export function parseCsv(text, delimiter = ',') {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const source = String(text ?? '')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
    .map(cells => cells.map(value => value.trim()))
    .filter(cells => cells.some(value => value !== ''))
}

/**
 * Map a header row to field indexes. Returns null when the row is not a header,
 * which is also how a bank's preamble (账号/日期范围 lines) gets skipped.
 */
export function mapColumns(headerRow) {
  const cells = (headerRow ?? []).map(normaliseHeader)
  const used = new Set()
  const mapping = {}
  for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
    for (const pattern of patterns) {
      const needle = normaliseHeader(pattern)
      const index = cells.findIndex((cell, position) => !used.has(position) && cell !== '' && cell.includes(needle))
      if (index >= 0) {
        mapping[field] = index
        used.add(index)
        break
      }
    }
  }
  const hasDate = Number.isInteger(mapping.date)
  const hasAmount = Number.isInteger(mapping.amount) || Number.isInteger(mapping.income) || Number.isInteger(mapping.expense)
  if (!hasDate || !hasAmount) return null
  return mapping
}

/** `¥1,234.50` / `(1234.5)` / `-1234.50` -> number, or null. */
export function parseAmount(value) {
  if (value === null || value === undefined) return null
  let text = String(value).trim().replace(/（/g, '(').replace(/）/g, ')')
  if (text === '' || text === '-' || text === '--') return null
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }
  text = text.replace(/[¥￥$,\s]/g, '').replace(/元$/, '')
  if (text.startsWith('-')) {
    negative = !negative
    text = text.slice(1)
  }
  const number = Number(text)
  if (!Number.isFinite(number)) return null
  return negative ? -number : number
}

/** Dates arrive as 2026-01-02, 2026/1/2, 20260102, 01/02/2026, with time tails. */
export function parseDate(value) {
  const text = String(value ?? '').trim()
  if (text === '') return null
  const stamped = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (stamped !== null) {
    const [, year, month, day] = stamped
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact !== null) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const slashed = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  if (slashed !== null) {
    const [, first, second, year] = slashed
    // Day-first when the first number cannot be a month.
    const [month, day] = Number(first) > 12 ? [second, first] : [first, second]
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  return null
}

/** `支出`/`借`/`DR` -> expense; `收入`/`贷`/`CR` -> income; otherwise null. */
export function parseDirection(value) {
  const text = String(value ?? '').trim()
  if (text === '') return null
  if (/借|支出|转出|付款|支取|付|dr|debit/i.test(text)) return 'expense'
  if (/贷|收入|转入|收款|存入|收|cr|credit/i.test(text)) return 'income'
  return null
}

/** A readable category for a statement line, so the dashboard groups meaningfully. */
export function classifyCategory(description, counterparty, direction, fallback = '') {
  if (fallback !== '' && fallback !== undefined && fallback !== null) return String(fallback).trim()
  const text = `${description ?? ''} ${counterparty ?? ''}`
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(text)) return category
  }
  return direction === 'income' ? '其他收入' : '其他支出'
}

/** Stable identity for a statement line; used to refuse the same row twice. */
export function transactionHash(transaction) {
  const material = [
    transaction.date,
    transaction.amount.toFixed(2),
    transaction.direction,
    String(transaction.description ?? '').replace(/\s+/g, ''),
    String(transaction.counterparty ?? '').replace(/\s+/g, ''),
    transaction.balance === null || transaction.balance === undefined ? '' : transaction.balance.toFixed(2),
  ].join('|')
  return createHash('sha1').update(material).digest('hex').slice(0, 16)
}

/** Whole-file identity: re-importing the same export is a no-op, not a doubling. */
export function fileFingerprint(buffer) {
  return createHash('sha1').update(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)).digest('hex')
}

/**
 * Every candidate table inside one statement file.
 *
 * A workbook can carry a cover tab before the statement, so callers pick the
 * sheet whose header they can map instead of trusting "the first one".
 */
export function statementSheets(buffer, filename = '') {
  const name = String(filename ?? '').toLowerCase()
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const kind = workbookKind(bytes)
  if (name.endsWith('.xls') || kind === 'xls') {
    throw new Error('旧版 .xls 不支持，请用 Excel 另存为 .xlsx 或 CSV 再导入')
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm') || kind === 'xlsx') {
    return xlsxSheets(bytes).map(sheet => ({ name: sheet.name, rows: sheet.rows, encoding: 'xlsx' }))
  }
  const { text, encoding } = decodeCsv(bytes)
  return [{ name: '', rows: parseCsv(text, detectDelimiter(text)), encoding }]
}

/**
 * Turn CSV cells into transactions.
 *
 * `skipped` counts rows with no usable date or amount: a bank file may carry a
 * summary line, and silently dropping it would make the totals wrong without
 * anyone noticing. The caller shows the number.
 */
export function toTransactions(rows, { file = '', importId = '' } = {}) {
  const list = (rows ?? []).filter(row => row.some(cell => cell !== ''))
  const headerIndex = list.findIndex(row => mapColumns(row) !== null)
  if (headerIndex < 0) return { transactions: [], skipped: list.length, mapping: null, headerIndex: -1 }
  const mapping = mapColumns(list[headerIndex])
  const transactions = []
  // The count is "rows this file had but the dashboard will not": the preamble
  // above the header, plus data rows with no usable date/amount. The header
  // itself is not a skipped row.
  let skipped = headerIndex
  for (let index = headerIndex + 1; index < list.length; index += 1) {
    const row = list[index]
    const date = parseDate(row[mapping.date])
    if (date === null) {
      skipped += 1
      continue
    }
    let direction = Number.isInteger(mapping.direction) ? parseDirection(row[mapping.direction]) : null
    let amount = null
    if (Number.isInteger(mapping.amount)) {
      amount = parseAmount(row[mapping.amount])
    }
    if (amount === null && Number.isInteger(mapping.income)) {
      const income = parseAmount(row[mapping.income])
      if (income !== null && income !== 0) {
        amount = Math.abs(income)
        direction = 'income'
      }
    }
    if (amount === null && Number.isInteger(mapping.expense)) {
      const expense = parseAmount(row[mapping.expense])
      if (expense !== null && expense !== 0) {
        amount = Math.abs(expense)
        direction = 'expense'
      }
    }
    if (amount === null) {
      skipped += 1
      continue
    }
    if (amount < 0) direction = direction ?? 'expense'
    if (direction === null) direction = amount < 0 ? 'expense' : 'income'
    const description = Number.isInteger(mapping.description) ? String(row[mapping.description] ?? '').trim() : ''
    const counterparty = Number.isInteger(mapping.counterparty) ? String(row[mapping.counterparty] ?? '').trim() : ''
    const explicitCategory = Number.isInteger(mapping.category) ? String(row[mapping.category] ?? '').trim() : ''
    const balance = Number.isInteger(mapping.balance) ? parseAmount(row[mapping.balance]) : null
    const transaction = {
      importId,
      file,
      line: index + 1,
      date,
      description: description.replace(/\s+/g, ' '),
      counterparty: counterparty.replace(/\s+/g, ' '),
      amount: Math.round(Math.abs(amount) * 100) / 100,
      direction,
      category: classifyCategory(description, counterparty, direction, explicitCategory),
      balance: balance === null ? null : Math.round(balance * 100) / 100,
    }
    transaction.hash = transactionHash(transaction)
    transactions.push(transaction)
  }
  return { transactions, skipped, mapping, headerIndex }
}

/** `YYYY-MM`, the bucket a monthly chart needs. */
export function monthKey(date) {
  return String(date ?? '').slice(0, 7)
}

/** Inclusive window. A missing bound is open. */
export function inRange(date, from, to) {
  if (from && String(date) < from) return false
  if (to && String(date) > to) return false
  return true
}

/** The filter the panel sends: period window plus category/direction/search. */
export function filterTransactions(transactions, filters = {}) {
  const { from = '', to = '', category = '', direction = '', q = '' } = filters
  const needle = String(q ?? '').trim().toLowerCase()
  return (transactions ?? []).filter(transaction => {
    if (!inRange(transaction.date, from, to)) return false
    if (category !== '' && transaction.category !== category) return false
    if (direction !== '' && transaction.direction !== direction) return false
    if (needle !== '') {
      const haystack = `${transaction.description ?? ''} ${transaction.counterparty ?? ''} ${transaction.category ?? ''}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    return true
  })
}

const round2 = value => Math.round(value * 100) / 100

/** Totals, a monthly series and a category split for one filtered window. */
export function summarizeFinance(transactions, filters = {}) {
  const rows = filterTransactions(transactions, filters)
  let income = 0
  let expense = 0
  const months = new Map()
  const categories = new Map()
  const counterparties = new Map()
  for (const transaction of rows) {
    const month = monthKey(transaction.date)
    if (!months.has(month)) months.set(month, { month, income: 0, expense: 0, count: 0 })
    const bucket = months.get(month)
    const category = transaction.category || '未分类'
    if (!categories.has(category)) categories.set(category, { category, income: 0, expense: 0, count: 0 })
    const split = categories.get(category)
    bucket.count += 1
    split.count += 1
    if (transaction.direction === 'income') {
      income += transaction.amount
      bucket.income += transaction.amount
      split.income += transaction.amount
    } else {
      expense += transaction.amount
      bucket.expense += transaction.amount
      split.expense += transaction.amount
      const name = transaction.counterparty || transaction.category || '未分类'
      if (!counterparties.has(name)) counterparties.set(name, { name, amount: 0, count: 0 })
      const payer = counterparties.get(name)
      payer.amount += transaction.amount
      payer.count += 1
    }
  }
  return {
    count: rows.length,
    totals: { income: round2(income), expense: round2(expense), net: round2(income - expense) },
    byMonth: [...months.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(bucket => ({ ...bucket, income: round2(bucket.income), expense: round2(bucket.expense) })),
    byCategory: [...categories.values()]
      .map(split => ({
        ...split,
        income: round2(split.income),
        expense: round2(split.expense),
        total: round2(split.income + split.expense),
      }))
      .sort((a, b) => b.total - a.total),
    topCounterparties: [...counterparties.values()]
      .map(item => ({ ...item, amount: round2(item.amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5),
    range: { from: filters.from ?? '', to: filters.to ?? '' },
  }
}

/** Both presets and an explicit range end up as one from/to pair. */
export function resolveRange(preset, now = new Date()) {
  const year = now.getFullYear()
  const month = now.getMonth()
  const pad = value => String(value).padStart(2, '0')
  const iso = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  if (preset === 'thisMonth') {
    return { from: `${year}-${pad(month + 1)}-01`, to: iso(new Date(year, month + 1, 0)) }
  }
  if (preset === 'last3') {
    const start = new Date(year, month - 2, 1)
    return { from: iso(start), to: iso(new Date(year, month + 1, 0)) }
  }
  if (preset === 'thisYear') {
    return { from: `${year}-01-01`, to: `${year}-12-31` }
  }
  return { from: '', to: '' }
}
