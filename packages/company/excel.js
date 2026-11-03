/**
 * Minimal Excel (.xlsx) reader — no dependencies.
 *
 * An .xlsx file is a ZIP whose entries are XML. Node ships zlib but no ZIP
 * reader, so this file does the two small jobs itself:
 *
 *   readZip -> entry name -> bytes      (central directory + inflateRaw)
 *   xlsxSheets -> sheet name -> rows[][] (workbook + sharedStrings + styles)
 *
 * Deliberately scoped: bank statements are flat tables, so merged cells,
 * pivot tables, formulas and .xls (BIFF8, a different binary format) are out
 * of scope. A .xls file is detected and refused with a readable message
 * instead of being parsed into nonsense.
 */
import { inflateRawSync } from 'node:zlib'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0]

/** `.xlsx`/`.xlsm` are ZIPs; `.xls` is the old OLE container. */
export function workbookKind(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === LOCAL_SIGNATURE) return 'xlsx'
  if (bytes.length >= 4 && OLE_SIGNATURE.every((value, index) => bytes[index] === value)) return 'xls'
  return 'unknown'
}

/**
 * Read every entry of a ZIP. Stored (method 0) and deflated (method 8) entries
 * are the only ones Excel writes, so those are the only two supported.
 */
export function readZip(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  // The end-of-central-directory record sits at the tail, after a variable
  // comment. Scan backwards over the largest comment ZIP allows (64 KiB).
  let eocd = -1
  const from = Math.max(0, bytes.length - 0x10000 - 22)
  for (let offset = bytes.length - 22; offset >= from; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx：找不到 ZIP 目录')
  const entryCount = bytes.readUInt16LE(eocd + 10)
  let cursor = bytes.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) break
    const method = bytes.readUInt16LE(cursor + 10)
    const compressedSize = bytes.readUInt32LE(cursor + 20)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    cursor += 46 + nameLength + extraLength + commentLength
    if (bytes.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) continue
    const localNameLength = bytes.readUInt16LE(localOffset + 26)
    const localExtraLength = bytes.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.subarray(dataStart, dataStart + compressedSize)
    if (method === 0) entries.set(name, Buffer.from(raw))
    else if (method === 8) entries.set(name, inflateRawSync(raw))
  }
  return entries
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Bank memos contain `&amp;` and friends; a raw match would print them. */
export function decodeXmlEntities(text) {
  return String(text ?? '').replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (match, body) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(parseInt(body.slice(2), 16))
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10))
    return XML_ENTITIES[body] ?? match
  })
}

/** Text of every `<t>` inside a fragment, in document order (rich text runs). */
function collectText(fragment) {
  let out = ''
  for (const match of String(fragment ?? '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    out += decodeXmlEntities(match[1])
  }
  return out
}

/** `AB12` -> column 27 (zero-based). */
export function columnIndex(reference) {
  const letters = String(reference ?? '').match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? ''
  let index = 0
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64)
  return index - 1
}

/** Builtin number formats Excel uses for dates (including the Asian variants). */
const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
])

const DATE_CODE = /(?:^|[^\\])[ymdhs]/i

/** Cell style index -> is the number a date? */
function dateStyles(stylesXml) {
  const custom = new Map()
  for (const match of String(stylesXml ?? '').matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    custom.set(Number(match[1]), decodeXmlEntities(match[2]))
  }
  const cellXfs = String(stylesXml ?? '').match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? ''
  const formats = []
  for (const match of cellXfs.matchAll(/<xf\b([^>]*)\/?>/g)) {
    const idMatch = match[1].match(/numFmtId="(\d+)"/)
    const id = idMatch ? Number(idMatch[1]) : 0
    const code = custom.get(id)
    formats.push({
      numFmtId: id,
      date: BUILTIN_DATE_FORMATS.has(id) || (code !== undefined && DATE_CODE.test(code)),
    })
  }
  return formats
}

/** Excel serial day -> `YYYY-MM-DD`. 25569 = 1970-01-01 in Excel's calendar. */
export function excelDate(serial) {
  const days = Number(serial)
  if (!Number.isFinite(days)) return null
  const date = new Date(Math.round((days - 25569) * 86400 * 1000))
  if (Number.isNaN(date.getTime())) return null
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function cellText(attributes, inner, shared, formats) {
  const type = attributes.match(/\bt="([^"]*)"/)?.[1] ?? 'n'
  if (type === 'inlineStr') return collectText(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? inner)
  const value = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]
  if (value === undefined) return ''
  if (type === 's') return shared[Number(value)] ?? ''
  if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE'
  if (type === 'str' || type === 'e') return decodeXmlEntities(value)
  // Numeric: a date only if the style says so, otherwise the raw number.
  const styleIndex = Number(attributes.match(/\bs="(\d+)"/)?.[1] ?? 0)
  if (formats[styleIndex]?.date === true) {
    const date = excelDate(value)
    if (date !== null) return date
  }
  return String(value)
}

/** One worksheet XML -> rows of strings, each row padded to its widest cell. */
export function parseSheetXml(xml, shared = [], formats = []) {
  const rows = []
  const sheetData = String(xml ?? '').match(/<sheetData[^>]*>([\s\S]*?)<\/sheetData>/)?.[1] ?? ''
  for (const rowMatch of sheetData.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(rowMatch[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1)
    const cells = []
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = cellMatch[1].match(/\br="([A-Z]+\d+)"/)?.[1]
      const index = reference === undefined ? cells.length : columnIndex(reference)
      while (cells.length < index) cells.push('')
      cells[index] = cellText(cellMatch[1], cellMatch[2], shared, formats)
    }
    // A self-closing <c/> carries no value; the regex above skips it, which is
    // fine: a missing cell and an empty cell read the same in a statement.
    const trimmed = cells.map(value => String(value ?? '').trim())
    while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop()
    if (trimmed.length === 0) continue
    while (rows.length < rowNumber - 1) rows.push([])
    rows[rowNumber - 1] = trimmed
  }
  return rows.filter(row => Array.isArray(row) && row.length > 0)
}

/** Relationships turn `rId1` into `worksheets/sheet1.xml`. */
function workbookSheets(entries) {
  const workbook = entries.get('xl/workbook.xml')?.toString('utf8') ?? ''
  const relationships = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? ''
  const targets = new Map()
  for (const match of relationships.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = match[1].match(/\bId="([^"]*)"/)?.[1]
    const target = match[1].match(/\bTarget="([^"]*)"/)?.[1]
    if (id && target) targets.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''))
  }
  const sheets = []
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = decodeXmlEntities(match[1].match(/\bname="([^"]*)"/)?.[1] ?? '')
    const id = match[1].match(/\br:id="([^"]*)"/)?.[1]
    const target = targets.get(id)
    if (target) sheets.push({ name, path: `xl/${target}` })
  }
  if (sheets.length === 0) {
    // Some writers omit the rels file; fall back to the conventional path.
    for (const path of entries.keys()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) sheets.push({ name: path.split('/').pop(), path })
    }
  }
  return sheets
}

/**
 * Every worksheet as rows. The caller picks the sheet that actually holds the
 * statement: a workbook often starts with a cover or a summary tab.
 */
export function xlsxSheets(buffer) {
  const kind = workbookKind(buffer)
  if (kind === 'xls') throw new Error('旧版 .xls 不支持，请用 Excel 另存为 .xlsx 或 CSV 再导入')
  if (kind !== 'xlsx') throw new Error('不是有效的 xlsx 文件')
  const entries = readZip(buffer)
  const shared = []
  const sharedXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') ?? ''
  for (const match of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(collectText(match[1]))
  const formats = dateStyles(entries.get('xl/styles.xml')?.toString('utf8') ?? '')
  const out = []
  for (const sheet of workbookSheets(entries)) {
    const xml = entries.get(sheet.path)?.toString('utf8')
    if (xml === undefined) continue
    out.push({ name: sheet.name, rows: parseSheetXml(xml, shared, formats) })
  }
  return out
}
