/**
 * Read the company ledger straight out of the app's SQLite database.
 *
 * The employee/company app already keeps the books in `finance` rows with
 * stable dimensions (`companies`, `departments`, `employees`), so the dashboard
 * should project that table instead of asking the owner to export it again.
 * The connection is opened read-only and closed in `finally`: this module never
 * writes to a database it does not own.
 *
 * `node:sqlite` is imported lazily. A host running an older Node must not fail
 * to load the whole plugin because of this one source.
 */
import { existsSync } from 'node:fs'

const round2 = value => Math.round(value * 100) / 100

/** `交易后余额：543,375.70` lives inside the bank note, not in its own column. */
export function parseBalance(note) {
  const match = String(note ?? '').match(/交易后余额[:：]\s*(-?[\d,]+(?:\.\d+)?)/)
  if (match === null) return null
  const value = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

/** Dimension values may already be a name; only map them when they are an id. */
function resolveName(dictionary, value) {
  const text = String(value ?? '').trim()
  if (text === '') return ''
  return dictionary.get(text) ?? text
}

/**
 * Map one `finance` row to the transaction shape the dashboard already speaks.
 *
 * `category` is prefixed with its group (`人力成本 · 薪资`) because the group is
 * how the owner reads the books; a flat category list hides the difference
 * between 薪资 and 各项税费 when both are "费用".
 */
export function financeRowToTransaction(row, dictionaries = {}) {
  const { companies = new Map(), departments = new Map(), employees = new Map() } = dictionaries
  const group = String(row.catGroup ?? '').trim()
  const name = String(row.category ?? '').trim()
  const category = group !== '' && name !== '' ? `${group} · ${name}` : (name || group || '未分类')
  const person = resolveName(employees, row.person)
  const dept = resolveName(departments, row.dept)
  const company = resolveName(companies, row.company)
  const note = String(row.note ?? '')
  return {
    id: `db_${row.id}`,
    source: 'sqlite',
    date: String(row.date ?? '').slice(0, 10),
    direction: String(row.type ?? '').includes('收入') ? 'income' : 'expense',
    amount: round2(Math.abs(Number(row.amount) || 0)),
    category,
    categoryGroup: group,
    categoryName: name,
    description: String(row.summary ?? '').trim(),
    counterparty: person || dept || company,
    company,
    dept,
    person,
    method: String(row.method ?? '').trim(),
    voucher: String(row.voucher ?? '').trim(),
    note,
    balance: parseBalance(note),
  }
}

/**
 * Open the database, read the ledger, close it. Throws one readable error per
 * failure mode: missing file, old Node, not a finance database.
 */
export async function readFinanceLedger(filePath) {
  if (typeof filePath !== 'string' || filePath === '') throw new Error('还没有配置数据库')
  if (!existsSync(filePath)) throw new Error(`数据库不存在：${filePath}`)

  let DatabaseSync
  try {
    ({ DatabaseSync } = await import('node:sqlite'))
  } catch {
    throw new Error('当前 Node 不支持 node:sqlite（需要 ≥ 22.5）')
  }

  let database
  try {
    database = new DatabaseSync(filePath, { readOnly: true })
  } catch (error) {
    throw new Error(`打不开数据库：${String(error?.message ?? error)}`)
  }

  try {
    const tables = new Set(
      database.prepare("select name from sqlite_master where type = 'table'").all().map(row => row.name),
    )
    if (tables.has('finance') === false) throw new Error('这个数据库没有 finance 表，不是财务库')
    const dictionary = table => {
      if (tables.has(table) === false) return new Map()
      return new Map(database.prepare(`select id, name from ${table}`).all().map(row => [row.id, row.name]))
    }
    const dictionaries = {
      companies: dictionary('companies'),
      departments: dictionary('departments'),
      employees: dictionary('employees'),
    }
    const rows = database.prepare('select * from finance order by date asc, id asc').all()
    const transactions = rows.map(row => financeRowToTransaction(row, dictionaries))
    return {
      transactions,
      categories: [...new Set(transactions.map(item => item.category))].sort((a, b) => a.localeCompare(b, 'zh')),
      companies: [...dictionaries.companies.values()],
      departments: [...dictionaries.departments.values()],
      range: {
        from: transactions[0]?.date ?? '',
        to: transactions[transactions.length - 1]?.date ?? '',
      },
    }
  } finally {
    // Closing in `finally` matters: a schema error must not leak a handle on a
    // database another process is writing.
    database.close()
  }
}
