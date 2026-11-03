import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { financeRowToTransaction, parseBalance, readFinanceLedger } from '../ledgerdb.js'

/** The app's real schema, trimmed to the tables the dashboard reads. */
function buildLedger(path) {
  const db = new DatabaseSync(path)
  db.exec('create table companies (id text primary key, name text, short text)')
  db.exec('create table departments (id text primary key, name text, company text)')
  db.exec('create table employees (id text primary key, name text)')
  db.exec(`create table finance (
    id text primary key, date text, type text, "catGroup" text, category text,
    company text, dept text, person text, amount real, method text,
    summary text, voucher text, note text)`)
  const company = db.prepare('insert into companies values (?, ?, ?)')
  company.run('c1', '华之语文化传播（北京）有限公司', '华之语')
  const department = db.prepare('insert into departments values (?, ?, ?)')
  department.run('d1', '软件研发部', 'c1')
  const employee = db.prepare('insert into employees values (?, ?)')
  employee.run('p1', '刘寄和')
  const insert = db.prepare('insert into finance values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  insert.run('f1', '2026-05-20', '支出', '人力成本', '社保公积金', 'c1', '', '', 4350, '对公转账',
    '委托收款｜北京住房公积金管理中心', '', '网点：交通银行北京天坛支行｜交易后余额：543,375.70｜源行：2')
  insert.run('f2', '2026-03-30', '收入', '其他收入', '税费退回', 'c1', '', '', 1615.24, '对公转账',
    '电子退库｜待报解预算收入-海淀支库', '', '')
  insert.run('f3', '2026-08-19', '支出', '办公采购', '设备采购', 'c1', 'd1', 'p1', 29724, '对公转账',
    '采购苹果笔记本电脑', '', '手工录入')
  db.close()
}

async function withLedger(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-ledger-'))
  const path = join(dir, 'app.db')
  try {
    buildLedger(path)
    return await fn(path, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('the balance lives in the note and is read out of it', () => {
  assert.equal(parseBalance('网点：交通银行｜交易后余额：543,375.70｜源行：2'), 543375.7)
  assert.equal(parseBalance('交易后余额: 1,000.00'), 1000)
  assert.equal(parseBalance('没有余额信息'), null)
})

test('one ledger row becomes a transaction with its dimensions resolved', () => {
  const dictionaries = {
    companies: new Map([['c1', '华之语']]),
    departments: new Map([['d1', '软件研发部']]),
    employees: new Map([['p1', '刘寄和']]),
  }
  const transaction = financeRowToTransaction({
    id: 'f3', date: '2026-08-19', type: '支出', catGroup: '办公采购', category: '设备采购',
    company: 'c1', dept: 'd1', person: 'p1', amount: 29724, method: '对公转账',
    summary: '采购苹果笔记本电脑', voucher: '', note: '',
  }, dictionaries)
  assert.equal(transaction.direction, 'expense')
  assert.equal(transaction.amount, 29724)
  assert.equal(transaction.category, '办公采购 · 设备采购', 'the group qualifies the category')
  assert.equal(transaction.company, '华之语')
  assert.equal(transaction.dept, '软件研发部')
  assert.equal(transaction.counterparty, '刘寄和', 'the person is the counterparty when present')
  assert.equal(transaction.description, '采购苹果笔记本电脑')
})

test('the database is read into the dashboard shape', async () => {
  await withLedger(async path => {
    const ledger = await readFinanceLedger(path)
    assert.equal(ledger.transactions.length, 3)
    assert.deepEqual(ledger.transactions.map(row => row.date), ['2026-03-30', '2026-05-20', '2026-08-19'])
    assert.deepEqual(ledger.transactions.map(row => row.direction), ['income', 'expense', 'expense'])
    assert.ok(ledger.categories.includes('人力成本 · 社保公积金'))
    assert.deepEqual(ledger.range, { from: '2026-03-30', to: '2026-08-19' })
    assert.deepEqual(ledger.companies, ['华之语文化传播（北京）有限公司'])
    const withBalance = ledger.transactions.find(row => row.id === 'db_f1')
    assert.equal(withBalance.balance, 543375.7)
  })
})

test('a missing file or a non-finance database fails with a readable message', async () => {
  await assert.rejects(() => readFinanceLedger('/tmp/definitely-not-here.db'), /数据库不存在/)
  const dir = await mkdtemp(join(tmpdir(), 'workbench-ledger-empty-'))
  try {
    const path = join(dir, 'empty.db')
    const db = new DatabaseSync(path)
    db.exec('create table notes (id integer)')
    db.close()
    await assert.rejects(() => readFinanceLedger(path), /没有 finance 表/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
