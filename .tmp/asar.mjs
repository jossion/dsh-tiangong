import fs from 'node:fs'
const ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
const fd = fs.openSync(ASAR, 'r')
const sizeBuf = Buffer.alloc(8)
fs.readSync(fd, sizeBuf, 0, 8, 0)
const pickleSize = sizeBuf.readUInt32LE(4)
const headerBuf = Buffer.alloc(pickleSize)
fs.readSync(fd, headerBuf, 0, pickleSize, 8)
const strLen = headerBuf.readUInt32LE(0)
const json = headerBuf.toString('utf8', 4, 4 + strLen)
const header = JSON.parse(json)
const base = 8 + pickleSize
globalThis.readFileFromAsar = p => {
  const parts = p.split('/').filter(Boolean)
  let node = header
  for (const part of parts) {
    node = node.files?.[part]
    if (!node) return null
  }
  if (node.files) return { dir: true, entries: Object.keys(node.files) }
  const buf = Buffer.alloc(node.size)
  fs.readSync(fd, buf, 0, node.size, base + Number(node.offset))
  return { dir: false, buf, size: node.size }
}
const args = process.argv.slice(2)
if (args[0] === 'ls') {
  const r = readFileFromAsar(args[1] ?? '')
  if (!r) { console.log('missing'); process.exit(1) }
  if (r.dir) console.log(r.entries.join('\n'))
  else console.log(r.buf.toString('utf8', 0, Math.min(2000, r.size)))
} else if (args[0] === 'cat') {
  const r = readFileFromAsar(args[1])
  if (!r || r.dir) { console.log('missing/dir'); process.exit(1) }
  process.stdout.write(r.buf)
} else if (args[0] === 'find') {
  const needle = args[1].toLowerCase()
  const hits = []
  const walk = (node, prefix) => {
    for (const [k, v] of Object.entries(node.files ?? {})) {
      const p = prefix + '/' + k
      if (v.files) walk(v, p)
      else { const s = Number(v.size); if (s < 400000 && p.toLowerCase().includes(needle)) hits.push(p + ' ' + s) }
    }
  }
  walk(header, '')
  console.log(hits.join('\n'))
}
