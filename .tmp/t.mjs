console.error('START')
import fs from 'node:fs'
const ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
const fd = fs.openSync(ASAR, 'r')
const sizeBuf = Buffer.alloc(8)
fs.readSync(fd, sizeBuf, 0, 8, 0)
console.error('pickleSize=', sizeBuf.readUInt32LE(4), 'first=', sizeBuf.readUInt32LE(0))
