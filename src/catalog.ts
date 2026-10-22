import type {
  CatalogBuilding,
  CatalogItem,
  CatalogNamed,
  CatalogQuest,
  CatalogRecipe,
  CatalogSkill,
  CatalogSpell,
  CatalogJournalEntry,
  CatalogVendor,
  MapBounds,
  MapIconType,
  MapRegionInfo,
  MapResourceGroup,
  MapResourceMarker,
  MapResourcesCalibration,
  MapResourcesCatalog,
  MapgenieContentUv,
} from './saves/types'

export type IconFolder = 'icons' | 'hud' | 'skills' | 'buildings' | 'spells' | 'journal' | 'map' | 'map-icons' | 'mounts'

export const items: CatalogItem[] = []
export const recipes: CatalogRecipe[] = []
export const skills: CatalogSkill[] = []
export const buildings: CatalogBuilding[] = []
export const catalogSpells: CatalogSpell[] = []
export const journalEntries: CatalogJournalEntry[] = []
export const hooks: CatalogNamed[] = []
export const ais: CatalogNamed[] = []
export const agilityCourses: CatalogNamed[] = []
export const vendors: CatalogVendor[] = []
export const quests: CatalogQuest[] = []

export const itemsById = new Map<string, CatalogItem>()
export const recipesById = new Map<string, CatalogRecipe>()
export const skillsById = new Map<string, CatalogSkill>()
export const buildingsById = new Map<string, CatalogBuilding>()
export const spellsById = new Map<string, CatalogSpell>()
export const journalById = new Map<string, CatalogJournalEntry>()
export const hooksById = new Map<string, CatalogNamed>()
export const aisById = new Map<string, CatalogNamed>()
export const agilityById = new Map<string, CatalogNamed>()
export const questsById = new Map<string, CatalogQuest>()
export const mapIconTypes: MapIconType[] = []
export const mapRegions: MapRegionInfo[] = []
export const mapResourceGroups: MapResourceGroup[] = []
export const mapResourceMarkers: MapResourceMarker[] = []
export let mapResourcesCalibration: MapResourcesCalibration | null = null
export let mapBounds: MapBounds = {
  minX: -12000,
  maxX: 408000,
  minY: -118550,
  maxY: 301450,
  flipY: false,
}

export const DEFAULT_MAPGENIE_CONTENT_UV: MapgenieContentUv = {
  u0: 0.3506,
  v0: 0.2122,
  u1: 0.8989,
  v1: 0.7598,
}

let loaded = false
let loadPromise: Promise<void> | null = null

export function catalogIconUrl(folder: IconFolder, icon: string | undefined): string | undefined {
  if (!icon) return undefined
  return `/catalog/${folder}/${encodeURIComponent(icon)}`
}

export function iconUrl(icon: string | undefined): string | undefined {
  return catalogIconUrl('icons', icon)
}

export function hudIconUrl(icon: string | undefined): string | undefined {
  return catalogIconUrl('hud', icon)
}

export function skillIconUrl(icon: string | undefined): string | undefined {
  return catalogIconUrl('skills', icon)
}

export function mapImageUrl(name: string): string {
  return `/catalog/map/${encodeURIComponent(name)}`
}

export function mapMarkerUrl(icon: string | undefined): string | undefined {
  return catalogIconUrl('map-icons', icon)
}

export function getItem(id: string | undefined | null): CatalogItem | undefined {
  if (!id) return undefined
  return itemsById.get(id)
}

export function getRecipe(id: string | undefined | null): CatalogRecipe | undefined {
  if (!id) return undefined
  return recipesById.get(id)
}

export function itemLabel(id: string | undefined | null): string {
  if (!id) return 'Empty'
  return getItem(id)?.name ?? id
}

export function recipeLabel(id: string | undefined | null): string {
  if (!id) return ''
  const recipe = getRecipe(id)
  if (!recipe) return id
  return getItem(recipe.outputId)?.name ?? recipe.name ?? id
}

export function getSkill(id: string | undefined | null): CatalogSkill | undefined {
  if (!id) return undefined
  return skillsById.get(id)
}

export function skillLabel(id: string | undefined | null): string {
  if (!id) return ''
  return getSkill(id)?.name ?? id
}

export function buildingLabel(id: string | undefined | null): string {
  if (!id) return ''
  return buildingsById.get(id)?.name ?? id
}

export function getSpell(id: string | undefined | null): CatalogSpell | undefined {
  if (!id) return undefined
  return spellsById.get(id)
}

export function spellLabel(id: string | undefined | null): string {
  if (!id) return ''
  return getSpell(id)?.name ?? id
}

export function getJournalEntry(id: string | undefined | null): CatalogJournalEntry | undefined {
  if (!id) return undefined
  return journalById.get(id)
}

export function journalLabel(id: string | undefined | null): string {
  if (!id) return ''
  return getJournalEntry(id)?.name ?? id
}

export function hookLabel(id: string | undefined | null): string {
  if (!id) return ''
  return hooksById.get(id)?.name ?? id
}

export function aiLabel(id: string | undefined | null): string {
  if (!id) return ''
  return aisById.get(id)?.name ?? id
}

export function agilityLabel(id: string | undefined | null): string {
  if (!id) return ''
  return agilityById.get(id)?.name ?? id
}

export function vendorLabel(tag: string | undefined | null): string {
  if (!tag) return ''
  return vendors.find((vendor) => vendor.tag === tag)?.name ?? tag
}

export function getQuest(id: string | undefined | null): CatalogQuest | undefined {
  if (!id) return undefined
  return questsById.get(id)
}

export function questLabel(id: string | undefined | null): string {
  if (!id) return ''
  return getQuest(id)?.name ?? id
}

export function questObjectiveLabel(questId: string | undefined | null, objectiveId: string | undefined | null): string {
  if (!objectiveId) return ''
  const quest = getQuest(questId)
  const match = quest?.objectives.find((objective) => objective.id === objectiveId)
  return match?.text || objectiveId
}

function reset(target: unknown[]): void {
  target.splice(0, target.length)
}

function fill<T extends { id: string }>(
  source: T[] | undefined,
  target: T[],
  index: Map<string, T>,
): void {
  reset(target)
  index.clear()
  for (const entry of source ?? []) {
    if (!entry.id) continue
    target.push(entry)
    index.set(entry.id, entry)
  }
}

async function optionalJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url)
  if (!response.ok) return null
  return (await response.json()) as T
}

export async function loadCatalog(): Promise<void> {
  if (loaded) return
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const [itemsRes, recipesRes, skillsRes, buildingsJson, spellsJson, journalJson, hooksJson, aisJson, agilityJson, vendorsJson, questsJson, boundsJson, regionsJson, mapTypesJson, resourcesJson] = await Promise.all([
      fetch('/catalog/items.json'),
      fetch('/catalog/recipes.json'),
      fetch('/catalog/skills.json'),
      optionalJson<{ buildings: CatalogBuilding[] }>('/catalog/buildings.json'),
      optionalJson<{ spells: CatalogSpell[] }>('/catalog/spells.json'),
      optionalJson<{ entries: CatalogJournalEntry[] }>('/catalog/journal.json'),
      optionalJson<{ hooks: CatalogNamed[] }>('/catalog/hooks.json'),
      optionalJson<{ ais: CatalogNamed[] }>('/catalog/ais.json'),
      optionalJson<{ courses: CatalogNamed[] }>('/catalog/agility.json'),
      optionalJson<{ vendors: CatalogVendor[] }>('/catalog/vendors.json'),
      optionalJson<{ quests: CatalogQuest[] }>('/catalog/quests.json'),
      optionalJson<MapBounds>('/catalog/map-bounds.json'),
      optionalJson<{ regions: MapRegionInfo[] }>('/catalog/map-regions.json'),
      optionalJson<{ types: MapIconType[]; background?: Record<string, string> }>('/catalog/map-icon-types.json'),
      optionalJson<MapResourcesCatalog>('/catalog/map-resources.json'),
    ])
    if (!itemsRes.ok) throw new Error('Item catalog missing. Run npm run catalog:pack')
    if (!recipesRes.ok) throw new Error('Recipe catalog missing. Run npm run catalog:pack')
    if (!skillsRes.ok) throw new Error('Skill catalog missing. Run npm run catalog:pack')
    const itemsJson = (await itemsRes.json()) as { items: CatalogItem[] }
    const recipesJson = (await recipesRes.json()) as { recipes: CatalogRecipe[] }
    const skillsJson = (await skillsRes.json()) as { skills: CatalogSkill[] }
    fill(itemsJson.items, items, itemsById)
    fill(
      (recipesJson.recipes ?? []).map((recipe) => ({
        ...recipe,
        name: getItem(recipe.outputId)?.name || recipe.name,
      })),
      recipes,
      recipesById,
    )
    fill(skillsJson.skills, skills, skillsById)
    fill(buildingsJson?.buildings, buildings, buildingsById)
    fill(spellsJson?.spells, catalogSpells, spellsById)
    fill(journalJson?.entries, journalEntries, journalById)
    fill(hooksJson?.hooks, hooks, hooksById)
    fill(aisJson?.ais, ais, aisById)
    fill(agilityJson?.courses, agilityCourses, agilityById)
    fill(
      (questsJson?.quests ?? []).map((quest) => ({
        ...quest,
        objectives: quest.objectives ?? [],
      })),
      quests,
      questsById,
    )
    reset(vendors)
    for (const vendor of vendorsJson?.vendors ?? []) {
      if (vendor.tag) vendors.push(vendor)
    }
    if (boundsJson && Number.isFinite(boundsJson.minX) && Number.isFinite(boundsJson.maxX)) {
      mapBounds = boundsJson
    }
    reset(mapRegions)
    for (const region of regionsJson?.regions ?? []) {
      if (typeof region.name === 'string' && Number.isFinite(region.bit)) mapRegions.push(region)
    }
    reset(mapIconTypes)
    for (const type of mapTypesJson?.types ?? []) {
      if (type.id) mapIconTypes.push(type)
    }
    reset(mapResourceGroups)
    reset(mapResourceMarkers)
    mapResourcesCalibration = resourcesJson?.calibration ?? null
    for (const group of resourcesJson?.groups ?? []) {
      if (!group?.id || !Array.isArray(group.categories)) continue
      mapResourceGroups.push({
        id: group.id,
        title: group.title || group.id,
        categories: group.categories.filter((category) => category?.id),
      })
    }
    for (const marker of resourcesJson?.markers ?? []) {
      if (!marker?.id || !Number.isFinite(marker.x) || !Number.isFinite(marker.y)) continue
      mapResourceMarkers.push(marker)
    }
    loaded = true
  })()
  return loadPromise
}

export const categories = () => [...new Set(items.map((item) => item.category).filter(Boolean))].sort()

const EQUIPABLE_CATEGORIES = new Set(['Armour', 'Weapons', 'Tools', 'Jewellery'])

export function isEquipableItem(item: CatalogItem | undefined): boolean {
  if (!item) return false
  if (EQUIPABLE_CATEGORIES.has(item.category)) return true
  return typeof item.baseDurability === 'number' && item.baseDurability > 0 && (item.maxStackSize ?? 1) <= 1
}

/** Whether a catalog item can be equipped in an Ammo / MagicAmmo / Bolts / Bait loadout slot. */
export function itemMatchesLoadoutPointer(
  item: CatalogItem | undefined,
  kind: 'arrows' | 'runes' | 'bolts' | 'bait',
): boolean {
  if (!item) return false
  const name = item.name
  switch (kind) {
    case 'arrows':
      return item.category === 'Ammo' && /arrow/i.test(name)
    case 'bolts':
      return item.category === 'Ammo' && /bolt/i.test(name)
    case 'bait':
      return item.category === 'Ammo' && (/bait|lure/i.test(name) || /animated feather/i.test(name))
    case 'runes':
      return item.category === 'MagicMaterials' && /\brune\b/i.test(name) && !/essence/i.test(name)
  }
}

export function itemHasDurability(item: CatalogItem | undefined): boolean {
  return isEquipableItem(item) && typeof item?.baseDurability === 'number' && item.baseDurability > 0
}

export function recipeIcon(recipe: CatalogRecipe): string | undefined {
  return getItem(recipe.outputId)?.icon
}

export function isJournalRecipe(recipe: CatalogRecipe): boolean {
  return recipe.journal === true || recipe.name.startsWith('Journal ')
}

export function craftingRecipes(): CatalogRecipe[] {
  return recipes.filter((recipe) => !isJournalRecipe(recipe))
}

export function journalRecipes(): CatalogRecipe[] {
  return recipes.filter((recipe) => isJournalRecipe(recipe))
}
