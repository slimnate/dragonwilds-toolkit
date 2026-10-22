/**
 * Extract MapGenie icomoon glyphs → data/map/icons/mg-*.png
 *
 * Sources (cached under exports/mapgenie/icons/):
 *   https://mapgenie.io/game-icons/runescape-dragonwilds/icons.css?v=1.1
 *   https://mapgenie.io/game-icons/runescape-dragonwilds/icons.woff?v=1
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const opentype = require('opentype.js')
const sharp = require('sharp')

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(scriptDir, '..')
const iconsDir = join(repoRoot, 'exports', 'mapgenie', 'icons')
const outDir = join(repoRoot, 'data', 'map', 'icons')
const SIZE = 64
const PAD = 6

function parseCssIcons(css) {
  const map = new Map()
  const re = /\.icon-([a-z0-9_]+):before\s*\{\s*content:\s*"\\([0-9a-fA-F]+)"/g
  let match
  while ((match = re.exec(css))) {
    map.set(match[1], Number.parseInt(match[2], 16))
  }
  return map
}

/**
 * Rasterize a glyph into a SIZE×SIZE SVG path, fitted with padding.
 * opentype getPath(x,y,fontSize): origin at (x,y), Y flipped into SVG space.
 */
function glyphToSvg(glyph, font, size) {
  const box = glyph.getBoundingBox()
  const gw = Math.max(box.x2 - box.x1, 1)
  const gh = Math.max(box.y2 - box.y1, 1)
  const inner = size - PAD * 2
  const unitScale = Math.min(inner / gw, inner / gh)
  const fontSize = unitScale * font.unitsPerEm

  // Place glyph origin so the bounding box is centered in the padded square.
  const x = PAD + (inner - gw * unitScale) / 2 - box.x1 * unitScale
  const y = PAD + (inner - gh * unitScale) / 2 + box.y2 * unitScale

  const path = glyph.getPath(x, y, fontSize)
  return path.toSVG(3)
}

async function main() {
  const cssPath = join(iconsDir, 'icons.css')
  const fontPath = join(iconsDir, 'icons.ttf')
  if (!existsSync(cssPath) || !existsSync(fontPath)) {
    console.error('Missing font files under exports/mapgenie/icons/ (icons.css + icons.ttf)')
    process.exit(1)
  }

  const icons = parseCssIcons(readFileSync(cssPath, 'utf8'))
  const font = opentype.parse(readFileSync(fontPath).buffer)
  mkdirSync(outDir, { recursive: true })

  let written = 0
  for (const [name, code] of icons) {
    const glyph = font.charToGlyph(String.fromCodePoint(code))
    if (!glyph || glyph.index === 0) {
      console.warn(`missing glyph: ${name} U+${code.toString(16)}`)
      continue
    }
    const pathSvg = glyphToSvg(glyph, font, SIZE)
    // MapGenie paints glyphs white; keep transparent BG so callers can tint/stack.
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  ${pathSvg.replace('<path', '<path fill="#ffffff"')}
</svg>`
    const png = await sharp(Buffer.from(svg))
      .ensureAlpha()
      .png()
      .toBuffer()
    writeFileSync(join(outDir, `mg-${name}.png`), png)
    written += 1
  }

  const manifest = {
    source: {
      css: 'https://mapgenie.io/game-icons/runescape-dragonwilds/icons.css?v=1.1',
      font: 'https://mapgenie.io/game-icons/runescape-dragonwilds/icons.woff?v=1',
    },
    size: SIZE,
    icons: [...icons.keys()].sort().map((name) => `mg-${name}.png`),
  }
  writeFileSync(join(iconsDir, 'extracted.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${written} icons → ${outDir}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
