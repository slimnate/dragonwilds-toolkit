import { isRegionRevealed } from './projection'

export type RegionMask = {
  width: number
  height: number
  ids: Uint8Array
}

const FOG_RGB = [10, 16, 26] as const
const FOG_ALPHA = 230

let maskPromise: Promise<RegionMask> | null = null

export function loadRegionMask(src: string): Promise<RegionMask> {
  if (!maskPromise) {
    maskPromise = decodeRegionMask(src).catch((error: unknown) => {
      maskPromise = null
      throw error
    })
  }
  return maskPromise
}

export function paintFogOverlay(
  canvas: HTMLCanvasElement,
  mask: RegionMask,
  bitmap: number,
) {
  if (canvas.width !== mask.width || canvas.height !== mask.height) {
    canvas.width = mask.width
    canvas.height = mask.height
  }
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) return
  const image = ctx.createImageData(mask.width, mask.height)
  const out = image.data
  const ids = mask.ids
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    if (!id || isRegionRevealed(bitmap, id - 1)) continue
    const o = i * 4
    out[o] = FOG_RGB[0]
    out[o + 1] = FOG_RGB[1]
    out[o + 2] = FOG_RGB[2]
    out[o + 3] = FOG_ALPHA
  }
  ctx.putImageData(image, 0, 0)
}

async function decodeRegionMask(src: string): Promise<RegionMask> {
  const img = await loadImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not read region mask')
  ctx.drawImage(img, 0, 0)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const ids = new Uint8Array(canvas.width * canvas.height)
  for (let i = 0, p = 0; i < ids.length; i++, p += 4) {
    const r = pixels[p] ?? 0
    const g = pixels[p + 1] ?? 0
    const b = pixels[p + 2] ?? 0
    if (r > 200 && g > 200 && b < 40) continue
    const id = Math.floor(r / 8)
    if (id >= 1 && id <= 31) ids[i] = id
  }
  return { width: canvas.width, height: canvas.height, ids }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load ${src}`))
    img.src = src
  })
}
