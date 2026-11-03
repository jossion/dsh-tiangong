/**
 * Build a real .xlsx in memory, so the Excel reader is tested against bytes and
 * not against a string fixture. No dependency is added: the ZIP container is
 * written here (this is a test helper, not product code).
 */
import { deflateRawSync } from 'node:zlib'

/** ZIP writer: stored or deflated entries, CRC left at 0 (the reader ignores it). */
export function zip(entries, { deflate = false } = {}) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const payload = deflate ? deflateRawSync(raw) : raw
    const method = deflate ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)

    localParts.push(local, name, payload)
    centralParts.push(central, name)
    offset += local.length + name.length + payload.length
  }
  const central = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, central, eocd])
}

/** Excel serial day for a `YYYY-MM-DD` string (the reader converts it back). */
export function excelSerial(date) {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000) + 25569
}

const xml = value => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * A workbook shaped like a bank export: a cover tab, then the statement tab
 * whose date column is a real Excel date (number + date style), not text.
 */
export function buildXlsx({ deflate = false } = {}) {
  const shared = ['交易日期', '交易摘要', '金额', '收支', '工资发放', '收入', '美团外卖', '支出', '账户明细 A&B']
  const si = shared.map(text => `<si><t>${xml(text)}</t></si>`).join('')
  const cell = (reference, value, { type = 'n', style = 0 } = {}) =>
    `<c r="${reference}"${type === 's' ? ' t="s"' : ''}${style ? ` s="${style}"` : ''}><v>${value}</v></c>`

  const cover = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>账号：6222 **** 8888</t></is></c></row>
  </sheetData></worksheet>`

  const statement = `<worksheet><sheetData>
    <row r="1">
      ${cell('A1', 0, { type: 's' })}${cell('B1', 1, { type: 's' })}${cell('C1', 2, { type: 's' })}${cell('D1', 3, { type: 's' })}
    </row>
    <row r="2">
      ${cell('A2', excelSerial('2026-01-05'), { style: 1 })}${cell('B2', 4, { type: 's' })}${cell('C2', 12000)}${cell('D2', 5, { type: 's' })}
    </row>
    <row r="3">
      ${cell('A3', excelSerial('2026-01-08'), { style: 1 })}${cell('B3', 6, { type: 's' })}${cell('C3', -38.5)}${cell('D3', 7, { type: 's' })}
    </row>
    <row r="4">
      ${cell('A4', excelSerial('2026-02-01'), { style: 1 })}<c r="B4" t="inlineStr"><is><t>房租 &amp; 物业</t></is></c>${cell('C4', -5000)}${cell('D4', 7, { type: 's' })}
    </row>
  </sheetData></worksheet>`

  const entries = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types/>' },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="封面" sheetId="1" r:id="rId1"/><sheet name="流水" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    },
    { name: 'xl/sharedStrings.xml', data: `<?xml version="1.0"?><sst count="${shared.length}">${si}</sst>` },
    {
      name: 'xl/styles.xml',
      data: `<?xml version="1.0"?><styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`,
    },
    { name: 'xl/worksheets/sheet1.xml', data: cover },
    { name: 'xl/worksheets/sheet2.xml', data: statement },
  ]
  return zip(entries, { deflate })
}
