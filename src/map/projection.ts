import type { MapBounds, MapgenieContentUv } from '../saves/types'

export function worldToUv(
  x: number,
  y: number,
  bounds: MapBounds,
): { u: number; v: number } {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const u = width === 0 ? 0.5 : (x - bounds.minX) / width
  const t = height === 0 ? 0.5 : (y - bounds.minY) / height
  return { u, v: bounds.flipY ? 1 - t : t }
}

export function uvToWorld(
  u: number,
  v: number,
  bounds: MapBounds,
): { x: number; y: number } {
  const t = bounds.flipY ? 1 - v : v
  return {
    x: bounds.minX + u * (bounds.maxX - bounds.minX),
    y: bounds.minY + t * (bounds.maxY - bounds.minY),
  }
}

/** MapGenie CRS bounds: [west, south, east, north] in lng/lat. */
export function mapgenieLatLngToUv(
  lat: number,
  lng: number,
  mapgenieBounds: [number, number, number, number],
  content: MapgenieContentUv,
): { u: number; v: number } {
  const [west, south, east, north] = mapgenieBounds
  const uCrs = (lng - west) / (east - west)
  const vCrs = (north - lat) / (north - south)
  const u = (uCrs - content.u0) / (content.u1 - content.u0)
  const v = (vCrs - content.v0) / (content.v1 - content.v0)
  return { u, v }
}

export function mapgenieLatLngToWorld(
  lat: number,
  lng: number,
  mapgenieBounds: [number, number, number, number],
  content: MapgenieContentUv,
  worldBounds: MapBounds,
): { x: number; y: number } {
  const { u, v } = mapgenieLatLngToUv(lat, lng, mapgenieBounds, content)
  return uvToWorld(u, v, worldBounds)
}

/** Landmass UV → MapGenie CRS UV via content rect. */
export function landUvToMapgenieCrs(
  u: number,
  v: number,
  content: MapgenieContentUv,
): { uCrs: number; vCrs: number } {
  return {
    uCrs: content.u0 + u * (content.u1 - content.u0),
    vCrs: content.v0 + v * (content.v1 - content.v0),
  }
}

/** MapGenie CRS UV → landmass UV via content rect. */
export function mapgenieCrsToLandUv(
  uCrs: number,
  vCrs: number,
  content: MapgenieContentUv,
): { u: number; v: number } {
  return {
    u: (uCrs - content.u0) / (content.u1 - content.u0),
    v: (vCrs - content.v0) / (content.v1 - content.v0),
  }
}

export function mapgenieCrsToLatLng(
  uCrs: number,
  vCrs: number,
  mapgenieBounds: [number, number, number, number],
): { lat: number; lng: number } {
  const [west, south, east, north] = mapgenieBounds
  return {
    lng: west + uCrs * (east - west),
    lat: north - vCrs * (north - south),
  }
}

/** CRS unit-square corners projected onto landmass UV for the given content crop. */
export function mapgenieCrsFrameOnLand(content: MapgenieContentUv): {
  u0: number
  v0: number
  u1: number
  v1: number
} {
  const nw = mapgenieCrsToLandUv(0, 0, content)
  const se = mapgenieCrsToLandUv(1, 1, content)
  return { u0: nw.u, v0: nw.v, u1: se.u, v1: se.v }
}

export function isRegionRevealed(bitmap: number, bit: number): boolean {
  return ((bitmap >>> bit) & 1) === 1
}

export function toggleRegionBit(bitmap: number, bit: number): number {
  return (bitmap ^ (1 << bit)) >>> 0
}

export function setRegionBit(bitmap: number, bit: number, on: boolean): number {
  const mask = 1 << bit
  return (on ? bitmap | mask : bitmap & ~mask) >>> 0
}

export function setRegionBits(bitmap: number, bits: number[], on: boolean): number {
  let next = bitmap
  for (const bit of bits) next = setRegionBit(next, bit, on)
  return next
}

export function regionGroupState(
  bitmap: number,
  regions: { bit: number }[],
): 'all' | 'some' | 'none' {
  if (regions.length === 0) return 'none'
  let revealed = 0
  for (const region of regions) {
    if (isRegionRevealed(bitmap, region.bit)) revealed += 1
  }
  if (revealed === 0) return 'none'
  if (revealed === regions.length) return 'all'
  return 'some'
}
