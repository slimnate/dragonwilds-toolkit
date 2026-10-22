/**
 * Build data/map/resources.json from MapGenie Ashenfall extract (+ optional official POIs).
 *
 * Calibration:
 * 1. MapGenie MapLibre raster source bounds [-1.4, 0, 0, 1.4] (west,south,east,north) → CRS UV
 * 2. The painted island only fills a sub-rectangle of that CRS (black padding around the art on
 *    MapGenie tiles). Our T_WorldMap_Landmass.png is that same art cropped to fill the texture.
 * 3. Map CRS UV through that content rect onto landmass UV [0,1], then to world XY via bounds.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const editorRoot = join(scriptDir, '..')
const repoRoot = editorRoot
const dataMapDir = join(repoRoot, 'data', 'map')
const mapgeniePath = join(repoRoot, 'exports', 'mapgenie', 'ashenfall.json')
const taxonomyPath = join(repoRoot, 'exports', 'mapgenie', 'taxonomy.json')
const boundsPath = join(dataMapDir, 'bounds.json')
const officialPath = join(dataMapDir, 'official-pois.json')
const outPath = join(dataMapDir, 'resources.json')

/** MapGenie raster tile bounds (lng/lat), from live style source `V2.bounds`. */
const MG_WEST = -1.4
const MG_SOUTH = 0
const MG_EAST = 0
const MG_NORTH = 1.4

/**
 * Island art AABB inside MapGenie CRS UV (image space: v grows south).
 * Tuned against MapGenie landmark placement (starting lodestone / anima vents).
 */
const MG_CONTENT = {
  u0: 0.3506,
  v0: 0.2122,
  u1: 0.8989,
  v1: 0.7598,
}

/** Prefer official over MapGenie when same category within this world distance (uu). */
const PROXIMITY_UU = 2000

const DENSE_CATEGORY_TITLES = new Set([
  'Chest',
  'Net Fishing Spot',
  'Rod Fishing Spot',
  'Adamantite Node',
  'Barrel Cactus',
  'Bittercap Mushroom',
  'Bunny Cactus',
  'Cabbage',
  'Cadavaberries',
  'Clay Node',
  'Coal Node',
  'Copper Ore Node',
  'Corpse Cotton',
  'Desert Weed',
  'Dwellberries',
  'Fibrous Pipe Cactus',
  'Flax',
  'Gold Ore Node',
  'Granite Deposit',
  'Gypsum Node',
  'Harralander',
  'Iron Ore Node',
  'Limestone Rock',
  'Marrentill',
  'Mithril Ore Node',
  'Onion',
  'Potato',
  'Pumpkin',
  'Redberry Bush',
  'Rune Geyser',
  'Salvage',
  'Sandstone Rock',
  'Silver Ore Node',
  'Snapdragon',
  'Swamp Tar',
  'Swamp Weed',
  'Thorny Irit Root',
  'Tin Ore Node',
  'Toadflax',
  'Blightwood Root',
])

/** MapGenie category.icon → PNG under data/map/icons (from extract-mapgenie-icons.mjs). */
function mapgenieIconKey(icon) {
  if (!icon || typeof icon !== 'string') return null
  return `mg-${icon}.png`
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function mapgenieToUv(lat, lng) {
  const uCrs = (lng - MG_WEST) / (MG_EAST - MG_WEST)
  const vCrs = (MG_NORTH - lat) / (MG_NORTH - MG_SOUTH)
  const u = (uCrs - MG_CONTENT.u0) / (MG_CONTENT.u1 - MG_CONTENT.u0)
  const v = (vCrs - MG_CONTENT.v0) / (MG_CONTENT.v1 - MG_CONTENT.v0)
  return { u, v }
}

function uvToWorld(u, v, bounds) {
  const t = bounds.flipY ? 1 - v : v
  return {
    x: bounds.minX + u * (bounds.maxX - bounds.minX),
    y: bounds.minY + t * (bounds.maxY - bounds.minY),
  }
}

function mapgenieToWorld(lat, lng, bounds) {
  const { u, v } = mapgenieToUv(lat, lng)
  return uvToWorld(u, v, bounds)
}

function dist2(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function categoryColor(id) {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  const hue = hash % 360
  return `hsl(${hue} 58% 52%)`
}

if (!existsSync(mapgeniePath)) {
  console.error(`Missing MapGenie extract: ${mapgeniePath}`)
  process.exit(1)
}
if (!existsSync(boundsPath)) {
  console.error(`Missing bounds: ${boundsPath}`)
  process.exit(1)
}

const ashenfall = loadJson(mapgeniePath)
const taxonomy = existsSync(taxonomyPath) ? loadJson(taxonomyPath) : null
const bounds = loadJson(boundsPath)

const groupOrder = (taxonomy?.groups ?? ashenfall.groups ?? []).map((g) => g.title)
const groupByTitle = new Map()

for (const group of ashenfall.groups ?? []) {
  const groupId = slugify(group.title)
  const categories = (group.categories ?? []).map((cat) => {
    const id = slugify(cat.title)
    return {
      id,
      title: cat.title,
      iconKey: mapgenieIconKey(cat.icon),
      mapgenieIcon: cat.icon ?? null,
      color: categoryColor(id),
      defaultOn: !DENSE_CATEGORY_TITLES.has(cat.title),
      mapgenieCategoryId: cat.id,
    }
  })
  groupByTitle.set(group.title, {
    id: groupId,
    title: group.title,
    categories,
  })
}

const categoryByMapgenieId = new Map()
const categoryById = new Map()
for (const group of groupByTitle.values()) {
  for (const cat of group.categories) {
    categoryByMapgenieId.set(cat.mapgenieCategoryId, { groupId: group.id, category: cat })
    categoryById.set(cat.id, { groupId: group.id, category: cat })
  }
}

const markers = []

for (const loc of ashenfall.locations ?? []) {
  const meta = categoryByMapgenieId.get(loc.category_id)
  if (!meta) continue
  if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') continue
  const { x, y } = mapgenieToWorld(loc.lat, loc.lng, bounds)
  if (!Number.isFinite(x) || !Number.isFinite(y)) continue
  markers.push({
    id: `mg-${loc.id}`,
    groupId: meta.groupId,
    categoryId: meta.category.id,
    title: loc.title || meta.category.title,
    x,
    y,
    lat: loc.lat,
    lng: loc.lng,
    source: 'mapgenie',
    iconKey: meta.category.iconKey,
  })
}

let officialCount = 0
let replaced = 0
if (existsSync(officialPath)) {
  const officialFile = loadJson(officialPath)
  const officialMarkers = Array.isArray(officialFile.markers) ? officialFile.markers : []
  const prox2 = PROXIMITY_UU * PROXIMITY_UU
  const byCategory = new Map()
  for (const marker of markers) {
    const list = byCategory.get(marker.categoryId) ?? []
    list.push(marker)
    byCategory.set(marker.categoryId, list)
  }
  const dropIds = new Set()
  for (const poi of officialMarkers) {
    const catId = poi.categoryId || slugify(poi.category || poi.title || '')
    const meta = categoryById.get(catId)
    if (!meta && !poi.groupId) continue
    const groupId = poi.groupId || meta?.groupId
    const categoryId = catId
    const iconKey = poi.iconKey ?? meta?.category.iconKey ?? null
    const x = Number(poi.x)
    const y = Number(poi.y)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !groupId || !categoryId) continue
    officialCount += 1
    const peers = byCategory.get(categoryId) ?? []
    for (const peer of peers) {
      if (dist2(peer, { x, y }) <= prox2) {
        dropIds.add(peer.id)
        replaced += 1
      }
    }
    markers.push({
      id: poi.id || `off-${officialCount}`,
      groupId,
      categoryId,
      title: poi.title || meta?.category.title || categoryId,
      x,
      y,
      source: 'official',
      iconKey,
    })
  }
  if (dropIds.size) {
    for (let i = markers.length - 1; i >= 0; i -= 1) {
      if (markers[i].source === 'mapgenie' && dropIds.has(markers[i].id)) markers.splice(i, 1)
    }
  }
}

const groups = []
for (const title of groupOrder) {
  const group = groupByTitle.get(title)
  if (group) groups.push({
    id: group.id,
    title: group.title,
    categories: group.categories.map(({ id, title: catTitle, iconKey, color, defaultOn }) => ({
      id,
      title: catTitle,
      iconKey,
      color,
      defaultOn,
    })),
  })
}
for (const [title, group] of groupByTitle) {
  if (!groupOrder.includes(title)) {
    groups.push({
      id: group.id,
      title: group.title,
      categories: group.categories.map(({ id, title: catTitle, iconKey, color, defaultOn }) => ({
        id,
        title: catTitle,
        iconKey,
        color,
        defaultOn,
      })),
    })
  }
}

mkdirSync(dataMapDir, { recursive: true })
const payload = {
  version: 1,
  calibration: {
    mapgenieBounds: [MG_WEST, MG_SOUTH, MG_EAST, MG_NORTH],
    mapgenieContentUv: MG_CONTENT,
    worldBounds: bounds,
    proximityUu: PROXIMITY_UU,
  },
  groups,
  markers,
}

writeFileSync(outPath, `${JSON.stringify(payload)}\n`)

const bySource = markers.reduce((acc, m) => {
  acc[m.source] = (acc[m.source] || 0) + 1
  return acc
}, {})
console.log(`Wrote ${markers.length} markers → ${outPath}`)
console.log(`  sources: ${JSON.stringify(bySource)}`)
console.log(`  groups: ${groups.length}, categories: ${groups.reduce((n, g) => n + g.categories.length, 0)}`)
if (officialCount) console.log(`  official: ${officialCount} kept, ${replaced} MapGenie duplicates dropped`)
else console.log('  official: none (add data/map/official-pois.json to merge)')
