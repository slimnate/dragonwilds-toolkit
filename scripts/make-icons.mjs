import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const iconsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'icons')
mkdirSync(iconsDir, { recursive: true })

function crc32(buf) {
  let crc = ~0
  for (const byte of buf) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function makePng(size, r, g, b) {
  const raw = Buffer.alloc(size * (1 + size * 4))
  let o = 0
  for (let y = 0; y < size; y += 1) {
    raw[o] = 0
    o += 1
    for (let x = 0; x < size; x += 1) {
      const glow = (x - size / 2) ** 2 + (y - size / 2) ** 2 < (size * 0.18) ** 2
      raw[o] = glow ? 212 : r
      raw[o + 1] = glow ? 176 : g
      raw[o + 2] = glow ? 106 : b
      raw[o + 3] = 255
      o += 4
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return png
}

function makeIco(png) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry[0] = 0
  entry[1] = 0
  entry[2] = 0
  entry[3] = 0
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12)
  return Buffer.concat([header, entry, png])
}

const png32 = makePng(32, 28, 18, 42)
const png128 = makePng(128, 28, 18, 42)
writeFileSync(join(iconsDir, '32x32.png'), png32)
writeFileSync(join(iconsDir, '128x128.png'), png128)
writeFileSync(join(iconsDir, '128x128@2x.png'), makePng(256, 28, 18, 42))
writeFileSync(join(iconsDir, 'icon.ico'), makeIco(png128))
writeFileSync(join(iconsDir, 'icon.icns'), png128)
console.log('Wrote placeholder icons to', iconsDir)
