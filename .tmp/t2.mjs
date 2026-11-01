import fs from 'node:fs'
const ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
const fd = fs.openSync(ASAR, 'r')
const b = Buffer.alloc(8); fs.readSync(fd, b, 0, 8, 0)
const pickleSize = b.readUInt32LE(4)
const hb = Buffer.alloc(pickleSize); fs.readSync(fd, hb, 0, pickleSize, 8)
const strLen = hb.readUInt32LE(0)
const header = JSON.parse(hb.toString('utf8', 4, 4 + strLen))
console.log('top keys:', Object.keys(header))
console.log('root files:', Object.keys(header.files).slice(0, 10))
const dsh = header.files.dsh
console.log('dsh entries:', Object.keys(dsh.files).slice(0, 30))
