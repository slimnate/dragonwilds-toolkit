import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const editorRoot = join(scriptDir, '..')
const repoRoot = editorRoot
const dataDir = join(repoRoot, 'data')
const outDir = join(editorRoot, 'public', 'catalog')
const iconsOut = join(outDir, 'icons')
const force = process.argv.includes('--force')

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const itemsFile = loadJson(join(dataDir, 'items.json'))
const recipesFile = loadJson(join(dataDir, 'recipes.json'))
const sourceItems = Array.isArray(itemsFile.items) ? itemsFile.items : itemsFile
const sourceRecipes = Array.isArray(recipesFile.recipes) ? recipesFile.recipes : recipesFile

const DRINK_EFFECTS = {
  'ITEM_Consumable_Tea_Stamina_Reduction_Magic.json': 'Reduces the stamina cost of magic attacks by 33%.',
  'ITEM_Consumable_Tea_Stamina_Reduction_Magic_Cooling.json': 'Reduces the stamina cost of magic attacks by 33%. Grants resistance to scorch buildup.',
  'ITEM_Consumable_Tea_Stamina_Reduction_Attack.json': 'Reduces the stamina cost of physical attacks by 33%.',
  'ITEM_Consumable_Tea_Stamina_Reduction_Attack_Cooling.json': 'Reduces the stamina cost of physical attacks by 33%. Grants resistance to scorch buildup.',
  'ITEM_Consumable_Tea_Stamina_Reduction_Ranged.json': 'Reduces the stamina cost of ranged attacks by 33%.',
  'ITEM_Consumable_Tea_Stamina_Reduction_Ranged_Cooling.json': 'Reduces the stamina cost of ranged attacks by 33%. Grants resistance to scorch buildup.',
  'ITEM_Consumable_Tea_Stamina_Reduction_Dodge.json': 'Reduces the stamina cost of dodging by 33%.',
  'ITEM_Consumable_Tea_Stamina_Reduction_Dodge_Cooling.json': 'Reduces the stamina cost of dodging by 33%. Grants resistance to scorch buildup.',
  'ITEM_Consumable_Tea_Stamina_Reduction_Sprint.json': 'Reduces the stamina cost of sprinting by 50%.',
  'ITEM_Consumable_Tea_Stamina_Reduction_Sprint_Cooling.json': 'Reduces the stamina cost of sprinting by 50%. Grants resistance to scorch buildup.',
  'ITEM_Consumable_Tea_Maple.json': 'Reduces the stamina cost of block actions by 33%.',
  'ITEM_Consumable_Tea_Dwellberry.json': 'Thirst drains 33% slower.',
  'ITEM_Consumable_Tea_Redberry.json': 'Thirst drains 33% slower.',
  'ITEM_Consumable_Tea_Cadavaberry.json': 'Thirst drains 33% slower.',
  'ITEM_Consumable_Tea_Pumpkin.json': 'Restores health over time.',
  'ITEM_Consumable_Tea_Strong_Sweet.json': 'Reduces rest drain by 25%.',
  'ITEM_Consumable_Tea_Strong.json': 'Restores 20 rest.',
}

function isDrinkBuff(item) {
  const asset = String(item.sourceAsset || '')
  const path = String(item.assetPath || '')
  if (!/^ITEM_Consumable_Tea_/i.test(asset)) return false
  if (/_OLD\.json$/i.test(asset) || /\/Deprecated\//i.test(path)) return false
  return true
}

function drinkFields(item) {
  if (!isDrinkBuff(item)) return {}
  const description = DRINK_EFFECTS[item.sourceAsset]
  return description ? { drinkBuff: true, description } : { drinkBuff: true }
}

const items = sourceItems.map((item) => ({
  id: item.persistenceId,
  name: item.name || item.rowName || item.persistenceId,
  category: item.category || 'Misc',
  subcategory: item.subcategory,
  icon: item.icon,
  maxStackSize: item.maxStackSize,
  baseDurability: item.baseDurability,
  vitalShield: item.vitalShield,
  weight: item.weight,
  powerLevel: item.powerLevel,
  ...drinkFields(item),
})).filter((item) => typeof item.id === 'string' && item.id)

const itemsByPackedId = new Map(items.map((item) => [item.id, item]))
const itemsByName = new Map(
  items
    .filter((item) => typeof item.name === 'string' && item.name)
    .map((item) => [item.name.toLowerCase(), item]),
)

function isJournalRecipe(recipe) {
  const source = recipe.sourceAsset || ''
  const path = recipe.assetPath || ''
  const row = recipe.rowName || ''
  const name = recipe.name || ''
  return source.startsWith('RECIPE_Journal_')
    || path.includes('/JournalEntries/')
    || row.startsWith('recipe_journal_')
    || name.startsWith('Journal ')
}

function journalCategory(recipe) {
  const blob = `${recipe.sourceAsset || ''} ${recipe.assetPath || ''} ${recipe.name || ''}`
  if (/Quest/i.test(blob)) return 'Quests'
  if (/Food|Drink/i.test(blob)) return 'Food'
  return 'Materials'
}

function journalDisplayName(recipe) {
  const stem = String(recipe.sourceAsset || '').replace(/\.json$/i, '')
  let rest = stem.replace(/^RECIPE_Journal_/i, '')
  rest = rest.replace(/^(Materials_Basic_|Materials_Special_|Materials_Poison_|Food_|Drink_|Quests_|Quest_)/i, '')
  rest = rest.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return rest || recipe.name || recipe.rowName || recipe.persistenceId
}

const recipes = sourceRecipes.map((recipe) => {
  const journal = isJournalRecipe(recipe)
  const output = typeof recipe.outputPersistenceId === 'string'
    ? itemsByPackedId.get(recipe.outputPersistenceId)
    : undefined
  const namedFromAsset = journal ? journalDisplayName(recipe) : ''
  const matchedItem = journal && !output ? itemsByName.get(namedFromAsset.toLowerCase()) : undefined
  const packed = {
    id: recipe.persistenceId,
    name: output?.name || matchedItem?.name || (journal ? namedFromAsset : '') || recipe.name || recipe.rowName || recipe.persistenceId,
    skill: recipe.skill,
    station: recipe.station,
    outputId: recipe.outputPersistenceId || matchedItem?.id,
  }
  if (journal) {
    packed.journal = true
    packed.category = journalCategory(recipe)
  }
  return packed
}).filter((recipe) => typeof recipe.id === 'string' && recipe.id)

mkdirSync(iconsOut, { recursive: true })

const hudSrc = join(dataDir, 'hud')
const hudOut = join(outDir, 'hud')
mkdirSync(hudOut, { recursive: true })
let hudCopied = 0
if (existsSync(hudSrc)) {
  for (const name of readdirSync(hudSrc).filter((file) => file.toLowerCase().endsWith('.png'))) {
    copyFileSync(join(hudSrc, name), join(hudOut, name))
    hudCopied += 1
  }
}

const iconsSrc = join(dataDir, 'icons')
let copied = 0
let missing = 0
const needed = new Set(items.map((item) => item.icon).filter(Boolean))

if (existsSync(iconsSrc)) {
  const have = new Set(
    existsSync(iconsOut)
      ? readdirSync(iconsOut).filter((name) => name.toLowerCase().endsWith('.png'))
      : [],
  )
  for (const icon of needed) {
    const dest = join(iconsOut, icon)
    if (!force && have.has(icon) && existsSync(dest)) continue
    const src = join(iconsSrc, icon)
    if (!existsSync(src)) {
      missing += 1
      continue
    }
    copyFileSync(src, dest)
    copied += 1
  }
} else {
  missing = needed.size
}

writeFileSync(join(outDir, 'items.json'), `${JSON.stringify({ items }, null, 2)}\n`)
writeFileSync(join(outDir, 'recipes.json'), `${JSON.stringify({ recipes }, null, 2)}\n`)

let skillsPacked = 0
const skillsPath = join(dataDir, 'skills.json')
if (existsSync(skillsPath)) {
  const skillsFile = loadJson(skillsPath)
  const sourceSkills = Array.isArray(skillsFile.skills) ? skillsFile.skills : []
  const detailsPath = join(dataDir, 'skill-details.json')
  const detailByName = new Map()
  if (existsSync(detailsPath)) {
    const detailsFile = loadJson(detailsPath)
    for (const detail of detailsFile.skills ?? []) {
      if (detail?.name) detailByName.set(detail.name, detail)
    }
  }
  const packedSkills = sourceSkills.map((skill) => {
    const detail = detailByName.get(skill.name)
    return {
      id: skill.persistenceId,
      name: skill.name,
      icon: skill.icon,
      deprecated: skill.deprecated,
      description: detail?.description,
      buff: detail?.buff,
      unlocks: detail?.unlocks,
    }
  }).filter((skill) => typeof skill.id === 'string' && skill.id)
  writeFileSync(join(outDir, 'skills.json'), `${JSON.stringify({ skills: packedSkills }, null, 2)}\n`)
  skillsPacked = packedSkills.length
}

const skillsSrc = join(dataDir, 'skills')
const skillsOut = join(outDir, 'skills')
mkdirSync(skillsOut, { recursive: true })
for (const name of readdirSync(skillsOut).filter((file) => file.toLowerCase().endsWith('.png'))) {
  unlinkSync(join(skillsOut, name))
}
let skillIcons = 0
if (existsSync(skillsSrc)) {
  for (const name of readdirSync(skillsSrc).filter((file) => file.toLowerCase().endsWith('.png'))) {
    copyFileSync(join(skillsSrc, name), join(skillsOut, name))
    skillIcons += 1
  }
}

function packNamedCatalog(fileName, listKey, packKey) {
  const path = join(dataDir, fileName)
  if (!existsSync(path)) return 0
  const payload = loadJson(path)
  const source = Array.isArray(payload[listKey]) ? payload[listKey] : []
  const packed = source.map((entry) => ({
    id: entry.persistenceId,
    name: entry.name || entry.rowName || entry.persistenceId,
    icon: entry.icon,
    category: entry.category,
    skill: entry.skill,
    description: entry.description,
    level: entry.level,
    cooldown: entry.cooldown,
    runes: entry.runes,
  })).filter((entry) => typeof entry.id === 'string' && entry.id)
  writeFileSync(join(outDir, `${packKey}.json`), `${JSON.stringify({ [listKey]: packed }, null, 2)}\n`)
  return packed.length
}

function syncPngDir(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true })
  if (existsSync(destDir)) {
    for (const name of readdirSync(destDir).filter((file) => file.toLowerCase().endsWith('.png'))) {
      unlinkSync(join(destDir, name))
    }
  }
  let count = 0
  if (!existsSync(srcDir)) return count
  for (const name of readdirSync(srcDir).filter((file) => file.toLowerCase().endsWith('.png'))) {
    copyFileSync(join(srcDir, name), join(destDir, name))
    count += 1
  }
  return count
}

const buildingsPacked = packNamedCatalog('buildings.json', 'buildings', 'buildings')
const spellsPacked = packNamedCatalog('spells.json', 'spells', 'spells')
const hooksPacked = packNamedCatalog('hooks.json', 'hooks', 'hooks')
const aisPacked = packNamedCatalog('ais.json', 'ais', 'ais')
const agilityPacked = packNamedCatalog('agility.json', 'courses', 'agility')

const vendorsPath = join(dataDir, 'vendors.json')
let vendorsPacked = 0
if (existsSync(vendorsPath)) {
  const vendorsFile = loadJson(vendorsPath)
  const packedVendors = (Array.isArray(vendorsFile.vendors) ? vendorsFile.vendors : [])
    .filter((vendor) => typeof vendor.tag === 'string' && vendor.tag)
  writeFileSync(join(outDir, 'vendors.json'), `${JSON.stringify({ vendors: packedVendors }, null, 2)}\n`)
  vendorsPacked = packedVendors.length
}

let questsPacked = 0
const questsPath = join(dataDir, 'quests.json')
if (existsSync(questsPath)) {
  const questsFile = loadJson(questsPath)
  const packedQuests = (Array.isArray(questsFile.quests) ? questsFile.quests : [])
    .map((quest) => ({
      id: quest.persistenceId,
      name: quest.name || quest.internalName || quest.persistenceId,
      description: quest.description,
      region: quest.region,
      kind: quest.kind,
      hidden: quest.hidden === true ? true : undefined,
      objectives: Array.isArray(quest.objectives)
        ? quest.objectives
          .filter((objective) => objective && typeof objective.id === 'string' && objective.id)
          .map((objective) => ({
            id: objective.id,
            text: objective.text || objective.id,
          }))
        : [],
    }))
    .filter((quest) => typeof quest.id === 'string' && quest.id)
  writeFileSync(join(outDir, 'quests.json'), `${JSON.stringify({ quests: packedQuests }, null, 2)}\n`)
  questsPacked = packedQuests.length
}

function indexPngs(root, into = new Map()) {
  if (!existsSync(root)) return into
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) indexPngs(full, into)
    else if (entry.name.toLowerCase().endsWith('.png')) {
      const key = entry.name.toLowerCase()
      if (!into.has(key)) into.set(key, full)
    }
  }
  return into
}

let journalPacked = 0
let journalIcons = 0
const journalPath = join(dataDir, 'journal.json')
if (existsSync(journalPath)) {
  const journalFile = loadJson(journalPath)
  const packedJournal = (Array.isArray(journalFile.entries) ? journalFile.entries : [])
    .map((entry) => ({
      id: entry.persistenceId,
      name: entry.name || entry.rowName || entry.persistenceId,
      icon: entry.icon,
      description: entry.description,
      category: entry.category || 'Knowledge',
      subcategory: entry.subcategory,
      group: entry.group,
      location: entry.location,
      deprecated: entry.deprecated === true ? true : undefined,
    }))
    .filter((entry) => typeof entry.id === 'string' && entry.id)
  writeFileSync(join(outDir, 'journal.json'), `${JSON.stringify({ entries: packedJournal }, null, 2)}\n`)
  journalPacked = packedJournal.length

  const journalOut = join(outDir, 'journal')
  mkdirSync(journalOut, { recursive: true })
  if (existsSync(journalOut)) {
    for (const name of readdirSync(journalOut).filter((file) => file.toLowerCase().endsWith('.png'))) {
      unlinkSync(join(journalOut, name))
    }
  }
  const pngIndex = indexPngs(join(repoRoot, 'exports', 'icons'))
  indexPngs(join(dataDir, 'icons'), pngIndex)
  const queued = []
  const seen = new Set()
  for (const entry of packedJournal) {
    if (!entry.icon) continue
    const key = String(entry.icon).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const src = pngIndex.get(key)
    if (src) queued.push({ src, name: entry.icon })
  }
  await Promise.all(queued.map(async ({ src, name }) => {
    try {
      await sharp(src).resize(128, 128, { fit: 'inside' }).png().toFile(join(journalOut, name))
      journalIcons += 1
    } catch {
      copyFileSync(src, join(journalOut, name))
      journalIcons += 1
    }
  }))
}

const buildingIcons = syncPngDir(join(dataDir, 'buildings'), join(outDir, 'buildings'))
const mountIcons = syncPngDir(join(dataDir, 'mounts'), join(outDir, 'mounts'))
const spellIcons = syncPngDir(join(dataDir, 'spells'), join(outDir, 'spells'))
const mapBackgrounds = syncPngDir(join(dataDir, 'map'), join(outDir, 'map'))
const mapIcons = syncPngDir(join(dataDir, 'map', 'icons'), join(outDir, 'map-icons'))

for (const name of ['icon-types.json', 'bounds.json', 'regions.json', 'resources.json']) {
  const src = join(dataDir, 'map', name)
  if (existsSync(src)) copyFileSync(src, join(outDir, `map-${name}`))
}

let mapResources = 0
const resourcesPackedPath = join(outDir, 'map-resources.json')
if (existsSync(resourcesPackedPath)) {
  const resourcesFile = loadJson(resourcesPackedPath)
  mapResources = Array.isArray(resourcesFile.markers) ? resourcesFile.markers.length : 0
}

console.log(`Packed ${items.length} items, ${recipes.length} recipes, ${skillsPacked} skills`)
console.log(`Progress: ${buildingsPacked} buildings, ${spellsPacked} spells, ${journalPacked} journal, ${hooksPacked} hooks, ${aisPacked} AIs, ${agilityPacked} courses, ${vendorsPacked} vendors, ${questsPacked} quests`)
console.log(`Icons: ${copied} copied, ${needed.size - copied - missing} already present, ${missing} missing`)
console.log(`HUD icons: ${hudCopied} copied`)
console.log(`Skill icons: ${skillIcons} copied`)
console.log(`Building icons: ${buildingIcons} copied`)
console.log(`Mount icons: ${mountIcons} copied`)
console.log(`Spell icons: ${spellIcons} copied`)
console.log(`Journal icons: ${journalIcons} copied`)
console.log(`Map backgrounds: ${mapBackgrounds} copied`)
console.log(`Map icons: ${mapIcons} copied`)
console.log(`Map resources: ${mapResources} markers`)
