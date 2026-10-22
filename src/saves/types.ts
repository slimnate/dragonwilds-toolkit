export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue | undefined }

export type CatalogItem = {
  id: string
  name: string
  category: string
  subcategory?: string
  icon?: string
  maxStackSize?: number
  baseDurability?: number
  vitalShield?: number
  weight?: number
  powerLevel?: number
  drinkBuff?: boolean
  description?: string
}

export type CatalogRecipe = {
  id: string
  name: string
  skill?: string
  station?: string
  outputId?: string
  journal?: boolean
  category?: string
}

export type SkillUnlock = {
  level: number
  name: string
  kind: string
  description: string
}

export type SkillBuff = {
  name: string
  summary: string
  perLevel?: number
  stacksFrom?: number
  reduce?: boolean
}

export type CatalogSkill = {
  id: string
  name: string
  icon?: string
  deprecated?: boolean
  description?: string
  buff?: SkillBuff
  unlocks?: SkillUnlock[]
}

export type CatalogBuilding = {
  id: string
  name: string
  icon?: string
  category?: string
}

export type CatalogSpell = {
  id: string
  name: string
  icon?: string
  skill?: string
  description?: string
  level?: number
  cooldown?: number
  runes?: string
}

export type CatalogJournalEntry = {
  id: string
  name: string
  icon?: string
  description?: string
  category: string
  subcategory?: string
  group?: string
  location?: string
  deprecated?: boolean
}

export type CatalogNamed = {
  id: string
  name: string
  icon?: string
}

export type CatalogVendor = {
  tag: string
  name: string
}

export type CatalogQuestObjective = {
  id: string
  text: string
}

export type CatalogQuest = {
  id: string
  name: string
  description?: string
  region?: string
  kind?: 'main' | 'side' | 'task'
  hidden?: boolean
  objectives: CatalogQuestObjective[]
}

export type MapBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  flipY: boolean
}

export type MapRegionInfo = {
  id: number
  bit: number
  name: string
  group?: string
}

export type MapIconType = {
  id: string
  value: number
  icon: string
  legend: string
}

export type MapResourceCategory = {
  id: string
  title: string
  iconKey?: string | null
  color?: string
  defaultOn: boolean
}

export type MapResourceGroup = {
  id: string
  title: string
  categories: MapResourceCategory[]
}

export type MapResourceMarker = {
  id: string
  groupId: string
  categoryId: string
  title: string
  x: number
  y: number
  /** MapGenie lat (kept so content UV can be retuned live). */
  lat?: number
  /** MapGenie lng (kept so content UV can be retuned live). */
  lng?: number
  source: 'official' | 'mapgenie'
  iconKey?: string | null
}

export type MapgenieContentUv = {
  u0: number
  v0: number
  u1: number
  v1: number
}

export type MapResourcesCalibration = {
  mapgenieBounds: [number, number, number, number]
  mapgenieContentUv: MapgenieContentUv
  worldBounds?: MapBounds
  proximityUu?: number
}

export type MapResourcesCatalog = {
  version?: number
  calibration?: MapResourcesCalibration
  groups: MapResourceGroup[]
  markers: MapResourceMarker[]
}

export type ItemSlot = {
  GUID?: string
  ItemData?: string
  Count?: number
  Durability?: number
  VitalShield?: number
  NumUpgradesApplied?: number
  PlayerInventoryItemIndex?: number
  [key: string]: JsonValue | undefined
}

export type CharacterFileInfo = {
  path: string
  name: string
}
