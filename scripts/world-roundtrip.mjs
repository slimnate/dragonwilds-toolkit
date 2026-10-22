import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitChunk, findChild } from '../src/saves/spud/chunk.ts'
import {
  propertyBytes,
  withComponentNumber,
  withComponentString,
  withCustomScale,
  withDifficulty,
  withNameList,
  withWorldName,
} from '../src/saves/spud/edit.ts'
import { serializeUnrealJson } from '../src/saves/serialize.ts'
import { readNameList } from '../src/saves/spud/values.ts'
import { componentText, nameList, resourceState } from '../src/saves/spud/view.ts'
import { leafClass, parseWorld, propertyNumber } from '../src/saves/spud/world.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  'saves/8-10-26-save-bak/SaveGames/BonesRTheirMoney.sav',
  'saves/8-10-26-save-bak/SaveGames/N8+K8=GR8.sav',
  'saves/8-10-26-save-bak/SaveGames/HelloWorld.sav',
  'saves/09-25-26-save-bak/SaveGames/test-standard.sav',
  'saves/09-25-26-save-bak/SaveGames/test-custom.sav',
  'saves/09-25-26-save-bak/SaveGames/CR34T0R.sav',
]

function same(a, b) {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

let failed = 0
function check(ok, message) {
  if (ok) return
  failed++
  console.log('FAIL', message)
}

for (const relative of files) {
  const bytes = new Uint8Array(readFileSync(join(root, relative)))
  const doc = parseWorld(bytes)
  const emitted = emitChunk(doc.bytes, doc.root)
  const ok = same(bytes, emitted)
  console.log(`${ok ? 'ok' : 'FAIL'} ${relative} name=${doc.info.worldName} diff=${doc.info.difficulty} objects=${doc.objects.length} levels=${doc.info.levelCount}`)
  if (!ok) failed++
}

function loadCustom() {
  return parseWorld(new Uint8Array(readFileSync(join(root, 'saves/09-25-26-save-bak/SaveGames/test-custom.sav'))))
}

const custom = loadCustom()
const glob = findChild(custom.root, 'GLOB')
const globMagics = glob?.parts.filter((part) => part.kind === 'chunk').map((part) => part.node.magic) ?? []
check(globMagics.includes('GLAI') && globMagics.includes('GOBS'), `GLOB chunks ${globMagics.join(',')}`)

const harder = parseWorld(withDifficulty(parseWorld(withCustomScale(parseWorld(withWorldName(loadCustom(), 'test-custom-edited')), 'Difficulty.Player.DamageScale', 1.25)), 1))
check(harder.info.worldName === 'test-custom-edited', `world name ${harder.info.worldName}`)
check(harder.info.difficulty === 1, `difficulty ${harder.info.difficulty}`)
const damage = harder.custom.find((field) => field.name === 'Difficulty.Player.DamageScale')
check(damage?.value.kind === 'number' && Math.abs(damage.value.value - 1.25) < 0.001, 'custom scale')
const settings = harder.objects.find((object) => object.className.includes('PersistenceSubsystem'))
const settingName = settings?.properties.find((entry) => entry.key === 'WorldSaveSettings/WorldName')
const settingDiff = settings?.properties.find((entry) => entry.key === 'WorldSaveSettings/SurvivalDifficulty')
const settingScale = settings?.properties.find((entry) => entry.name === 'CustomDifficultySettings')
check(settingName?.value.kind === 'string' && settingName.value.value === 'test-custom-edited', 'settings name')
check(settingDiff?.value.kind === 'number' && settingDiff.value.value === 1, 'settings difficulty')
const scaleHit = settingScale?.value.kind === 'bytes'
  ? settingScale.value.floats.find((entry) => entry.tag === 'Difficulty.Player.DamageScale')
  : null
check(Boolean(scaleHit && Math.abs(scaleHit.value - 1.25) < 0.001), 'settings scale')
check(harder.info.revision === custom.info.revision, 'revision unchanged')

const progressDoc = loadCustom()
const progress = progressDoc.objects.find((object) => leafClass(object.className) === 'WorldProgressManager')
const hooks = progress ? nameList(progressDoc, progress, 'WorldHooksTriggered') : null
check(Array.isArray(hooks) && hooks.length === 1 && hooks[0].includes('WH_TempleFlyover'), `world hooks ${hooks}`)
if (progress && hooks) {
  const editedHooks = parseWorld(withNameList(progressDoc, progress.id, 'WorldHooksTriggered', [...hooks, 'WH_TestHook']))
  const again = editedHooks.objects.find((object) => object.id === progress.id)
  const nextHooks = again ? nameList(editedHooks, again, 'WorldHooksTriggered') : null
  check(nextHooks?.length === 2 && nextHooks[1] === 'WH_TestHook', `hook edit ${nextHooks}`)
  const original = propertyBytes(progressDoc, progress, 'WorldHooksTriggered')
  check(original && readNameList(original)?.[0] === hooks[0], 'original hook bytes')
}

const chestDoc = loadCustom()
const chest = chestDoc.objects.find((object) => /LootChest/.test(leafClass(object.className)) && componentText(chestDoc, object, 'InventoryComponent'))
check(Boolean(chest), 'chest with inventory')
if (chest) {
  const text = componentText(chestDoc, chest, 'InventoryComponent') ?? ''
  const parsed = JSON.parse(text)
  const slotKey = Object.keys(parsed).find((key) => {
    const slot = parsed[key]
    return key !== 'Version' && slot && typeof slot === 'object' && 'Count' in slot
  })
  check(Boolean(slotKey), `chest slot keys ${Object.keys(parsed).slice(0, 8).join(',')}`)
  if (slotKey) {
    const before = parsed[slotKey].Count
    parsed[slotKey].Count = before + 1
    const serialized = serializeUnrealJson(parsed)
    const body = text.endsWith('\n') ? serialized : serialized.replace(/\r?\n$/, '')
    const written = parseWorld(withComponentString(chestDoc, chest.id, 'InventoryComponent', body))
    const nextObject = written.objects.find((object) => object.id === chest.id)
    const nextText = componentText(written, nextObject, 'InventoryComponent')
    const next = JSON.parse(nextText ?? '{}')
    check(next[slotKey]?.Count === before + 1, `chest count ${before} -> ${next[slotKey]?.Count}`)
    check(written.info.worldName === chestDoc.info.worldName && written.info.difficulty === chestDoc.info.difficulty, `chest edit left file header ${written.info.worldName}`)
  }
}

const oreDoc = loadCustom()
const ore = oreDoc.objects.find((object) => leafClass(object.className) === 'BP_OreNode_Stone')
check(Boolean(ore), 'ore node')
if (ore) {
  const before = resourceState(oreDoc, ore)
  check(before.available !== null && before.health !== null, `ore fields health=${before.health} available=${before.available} timer=${before.timer}`)
  const written = parseWorld(withComponentNumber(oreDoc, ore.id, 'RespawnComponent', 1, 'i32', (before.available ?? 0) + 3))
  const again = written.objects.find((object) => object.id === ore.id)
  const next = again ? resourceState(written, again) : null
  check(next?.available === (before.available ?? 0) + 3, `ore available ${before.available} -> ${next?.available}`)
  check(next?.health === before.health && next?.timer === before.timer, 'ore health and timer unchanged')
  check(propertyNumber(again, 'bCanBeDamaged') === propertyNumber(ore, 'bCanBeDamaged'), 'ore flag unchanged')
  const cleared = parseWorld(withComponentNumber(written, ore.id, 'RespawnComponent', 2, 'i64', 0))
  const clearedOre = cleared.objects.find((object) => object.id === ore.id)
  check(resourceState(cleared, clearedOre).timer === 0, 'cleared respawn timer')
}

if (failed) {
  console.log(`${failed} failed`)
  process.exit(1)
}
console.log('all world round-trips passed')
