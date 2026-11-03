import { test } from 'node:test'
import assert from 'node:assert/strict'

import { decodeXmlEntities, columnIndex, excelDate, readZip, workbookKind, xlsxSheets } from '../excel.js'
import { buildXlsx, excelSerial } from './fixtures.mjs'
import {
  classifyCategory,
  decodeCsv,
  detectDelimiter,
  fileFingerprint,
  filterTransactions,
  parseAmount,
  parseCsv,
  parseDate,
  parseDirection,
  resolveRange,
  statementSheets,
  summarizeFinance,
  toTransactions,
  transactionHash,
} from '../finance.js'

test('a CSV with quoted commas and quotes parses into rows', () => {
  const rows = parseCsv('名称,金额\n"张三, 李四",1200\n"他说 ""好的""",-30\n')
  assert.deepEqual(rows, [
    ['名称', '金额'],
    ['张三, 李四', '1200'],
    ['他说 "好的"', '-30'],
  ])
})

test('the delimiter is detected instead of assumed to be a comma', () => {
  assert.equal(detectDelimiter('日期\t金额\n2026-01-01\t12'), '\t')
  assert.equal(detectDelimiter('日期;金额\n2026-01-01;12'), ';')
  assert.equal(detectDelimiter('日期,金额\n2026-01-01,12'), ',')
})

test('a UTF-8 statement keeps its Chinese text', () => {
  const buffer = Buffer.from('交易日期,摘要\n2026-01-01,工资\n', 'utf8')
  const { text, encoding } = decodeCsv(buffer)
  assert.equal(encoding, 'utf-8')
  assert.match(text, /工资/)
})

test('amounts arrive with currency marks, thousands separators and parentheses', () => {
  assert.equal(parseAmount('¥1,234.50'), 1234.5)
  assert.equal(parseAmount('（1,200）'), -1200)
  assert.equal(parseAmount('(800)'), -800)
  assert.equal(parseAmount('-38.5'), -38.5)
  assert.equal(parseAmount('--'), null)
  assert.equal(parseAmount('abc'), null)
})

test('the common bank date shapes all land on YYYY-MM-DD', () => {
  assert.equal(parseDate('2026-01-05'), '2026-01-05')
  assert.equal(parseDate('2026/1/5'), '2026-01-05')
  assert.equal(parseDate('20260105'), '2026-01-05')
  assert.equal(parseDate('2026-01-05 13:20:00'), '2026-01-05')
  assert.equal(parseDate('01/05/2026'), '2026-01-05')
  assert.equal(parseDate('31/12/2026'), '2026-12-31')
  assert.equal(parseDate('not a date'), null)
})

test('direction is read from words, never guessed from the column order', () => {
  assert.equal(parseDirection('支出'), 'expense')
  assert.equal(parseDirection('借'), 'expense')
  assert.equal(parseDirection('收入'), 'income')
  assert.equal(parseDirection('贷方'), 'income')
  assert.equal(parseDirection(''), null)
})

test('categories come from the line, so the dashboard groups meaningfully', () => {
  assert.equal(classifyCategory('工资发放', '', 'income'), '工资薪酬')
  assert.equal(classifyCategory('美团外卖订单', '美团', 'expense'), '餐饮')
  assert.equal(classifyCategory('房租转账', '张房东', 'expense'), '房租物业')
  assert.equal(classifyCategory('结息', '招商银行', 'income'), '利息理财')
  assert.equal(classifyCategory('不明支出', '', 'expense'), '其他支出')
  assert.equal(classifyCategory('不明收入', '', 'income'), '其他收入')
  assert.equal(classifyCategory('某笔', '', 'expense', '自定义'), '自定义')
})

test('a bank preamble is skipped, bad rows are counted instead of dropped silently', () => {
  const rows = parseCsv([
    '账户信息,xxx',
    '',
    '交易日期,交易摘要,交易金额,收支,余额',
    '2026-01-05,工资,12000,收入,12000',
    '合计,,12000,,',
    '2026-01-08,外卖,-38.5,支出,11961.5',
  ].join('\n'))
  const parsed = toTransactions(rows, { file: 'a.csv', importId: 'imp_1' })
  assert.equal(parsed.headerIndex, 1)
  assert.equal(parsed.transactions.length, 2)
  assert.equal(parsed.skipped, 2, 'the preamble and the total line are reported')
  assert.equal(parsed.transactions[0].direction, 'income')
  assert.equal(parsed.transactions[1].direction, 'expense')
  assert.equal(parsed.transactions[1].amount, 38.5, 'the amount is absolute, direction carries the sign')
})

test('separate debit/credit columns are understood, and the sign is derived', () => {
  const rows = parseCsv([
    '记账日期,摘要,借方金额,贷方金额',
    '2026-03-01,采购付款,500,',
    '2026-03-02,客户回款,,900',
  ].join('\n'))
  const parsed = toTransactions(rows, { file: 'b.csv', importId: 'imp_2' })
  assert.deepEqual(parsed.transactions.map(row => [row.direction, row.amount]), [
    ['expense', 500],
    ['income', 900],
  ])
})

test('the same row imported twice is refused by hash', () => {
  const base = { date: '2026-01-05', amount: 12000, direction: 'income', description: '工资', counterparty: '公司', balance: 12000 }
  assert.equal(transactionHash(base), transactionHash({ ...base }))
  assert.notEqual(transactionHash(base), transactionHash({ ...base, amount: 12001 }))
  assert.equal(fileFingerprint(Buffer.from('abc')), fileFingerprint(Buffer.from('abc')))
  assert.notEqual(fileFingerprint(Buffer.from('abc')), fileFingerprint(Buffer.from('abd')))
})

test('totals, months and categories come from one filtered window', () => {
  const transactions = [
    { date: '2026-01-05', amount: 12000, direction: 'income', category: '工资薪酬', counterparty: '公司', description: '工资' },
    { date: '2026-01-08', amount: 38.5, direction: 'expense', category: '餐饮', counterparty: '美团', description: '外卖' },
    { date: '2026-02-01', amount: 5000, direction: 'expense', category: '房租物业', counterparty: '房东', description: '房租' },
  ]
  const summary = summarizeFinance(transactions, { from: '2026-01-01', to: '2026-01-31' })
  assert.deepEqual(summary.totals, { income: 12000, expense: 38.5, net: 11961.5 })
  assert.equal(summary.count, 2)
  assert.equal(summary.byMonth.length, 1)
  assert.equal(summary.byMonth[0].month, '2026-01')
  assert.deepEqual(summary.byMonth[0], { month: '2026-01', income: 12000, expense: 38.5, count: 2 })
  assert.equal(summary.byCategory[0].category, '工资薪酬')
  assert.equal(summary.topCounterparties[0].name, '美团')

  const onlyExpenses = summarizeFinance(transactions, { direction: 'expense' })
  assert.deepEqual(onlyExpenses.totals, { income: 0, expense: 5038.5, net: -5038.5 })
  assert.equal(onlyExpenses.count, 2)

  const searched = filterTransactions(transactions, { q: '房租' })
  assert.equal(searched.length, 1)
  assert.equal(searched[0].category, '房租物业')
})

test('the preset ranges are real dates, not string arithmetic', () => {
  const now = new Date(2026, 10, 2) // 2026-11-02, local time
  assert.deepEqual(resolveRange('thisMonth', now), { from: '2026-11-01', to: '2026-11-30' })
  assert.deepEqual(resolveRange('last3', now), { from: '2026-09-01', to: '2026-11-30' })
  assert.deepEqual(resolveRange('thisYear', now), { from: '2026-01-01', to: '2026-12-31' })
  assert.deepEqual(resolveRange('all', now), { from: '', to: '' })
})

// ---- Excel (the format the statements actually arrive in) ----------------

test('an xlsx statement is read without adding a dependency', () => {
  const sheets = xlsxSheets(buildXlsx())
  assert.deepEqual(sheets.map(sheet => sheet.name), ['封面', '流水'])
  assert.deepEqual(sheets[1].rows, [
    ['交易日期', '交易摘要', '金额', '收支'],
    ['2026-01-05', '工资发放', '12000', '收入'],
    ['2026-01-08', '美团外卖', '-38.5', '支出'],
    ['2026-02-01', '房租 & 物业', '-5000', '支出'],
  ])
})

test('deflated xlsx entries are inflated too', () => {
  const sheets = xlsxSheets(buildXlsx({ deflate: true }))
  assert.equal(sheets[1].rows.length, 4, 'the deflate method is as supported as stored')
})

test('the statement sheet is chosen by its header, not by position', () => {
  const sheets = statementSheets(buildXlsx(), '银行流水.xlsx')
  const parsed = sheets
    .map(sheet => toTransactions(sheet.rows, { file: 'bank.xlsx', importId: 'imp_x' }))
    .find(candidate => candidate.headerIndex >= 0)
  assert.ok(parsed, 'the cover tab has no header and is skipped')
  assert.deepEqual(parsed.transactions.map(row => [row.date, row.direction, row.amount]), [
    ['2026-01-05', 'income', 12000],
    ['2026-01-08', 'expense', 38.5],
    ['2026-02-01', 'expense', 5000],
  ])
})

test('csv still works through the same entry point', () => {
  const sheets = statementSheets(Buffer.from('交易日期,金额,收支\n2026-01-05,12000,收入\n', 'utf8'), 'a.csv')
  assert.equal(sheets.length, 1)
  assert.equal(sheets[0].encoding, 'utf-8')
  assert.equal(sheets[0].rows.length, 2)
})

test('the old .xls container is refused with a readable message', () => {
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)])
  assert.throws(() => statementSheets(ole, '流水.xls'), /另存为/)
  assert.throws(() => statementSheets(ole, '流水.bin'), /另存为/, 'magic bytes catch a renamed file')
})

test('excel helpers: columns, serial dates, entities, container', () => {
  assert.equal(columnIndex('A1'), 0)
  assert.equal(columnIndex('Z9'), 25)
  assert.equal(columnIndex('AA100'), 26)
  assert.equal(excelDate(excelSerial('2026-01-05')), '2026-01-05')
  assert.equal(excelDate(excelSerial('2020-02-29')), '2020-02-29')
  assert.equal(decodeXmlEntities('房租 &amp; 物业 &#65;'), '房租 & 物业 A')
  assert.equal(workbookKind(buildXlsx()), 'xlsx')
  assert.equal(workbookKind(Buffer.from('a,b\n1,2')), 'unknown')
  assert.ok(readZip(buildXlsx()).get('xl/workbook.xml').toString('utf8').includes('流水'))
})
