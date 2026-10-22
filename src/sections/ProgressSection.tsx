import { useState } from 'react'
import { Collapsible } from '../components/Collapsible'
import { UnlockCatalog } from '../components/UnlockCatalog'
import { ItemIdList } from '../components/ItemIdList'
import { IdListEditor } from '../components/IdListEditor'
import {
  agilityCourses,
  agilityLabel,
  ais,
  buildings,
  catalogSpells,
  craftingRecipes,
  getRecipe,
  hooks,
  journalRecipes,
  recipeIcon,
  vendorLabel,
  vendors,
} from '../catalog'
import { asObject, getGameplayRoot, getStringArray } from '../saves/access'
import { AGILITY_MEDALS } from '../saves/lookups'
import type { JsonObject, JsonValue } from '../saves/types'

type Props = {
  save: JsonObject
  onChange: (save: JsonObject) => void
}

export function ProgressSection({ save, onChange }: Props) {
  const progress = asObject(getGameplayRoot(save).Progress) ?? {}

  function patch(mutate: (block: JsonObject) => void) {
    const next = structuredClone(save)
    const block = asObject(getGameplayRoot(next).Progress) ?? {}
    mutate(block)
    getGameplayRoot(next).Progress = block
    onChange(next)
  }

  function setList(key: string, values: string[]) {
    patch((block) => {
      block[key] = values
    })
  }

  function setLists(updates: Record<string, string[]>) {
    patch((block) => {
      for (const [key, values] of Object.entries(updates)) {
        block[key] = values
      }
    })
  }

  function mergeRecipeLists(
    inGroup: (id: string) => boolean,
    nextUnlocked: string[],
    nextNew?: string[],
  ) {
    const unlockedRecipes = getStringArray(progress.RecipesUnlocked)
    const newRecipes = getStringArray(progress.RecipesNew)
    setLists({
      RecipesUnlocked: [
        ...unlockedRecipes.filter((id) => !inGroup(id)),
        ...nextUnlocked,
      ],
      RecipesNew: [
        ...newRecipes.filter((id) => !inGroup(id)),
        ...(nextNew ?? []),
      ],
    })
  }

  const reps = Array.isArray(progress.VendorReputations)
    ? progress.VendorReputations.filter(isObject)
    : []
  const agilityRows = Array.isArray(progress.AgilityCourseScores)
    ? progress.AgilityCourseScores.filter(isObject)
    : []
  const agilityById = new Map<string, JsonObject>()
  for (const row of agilityRows) {
    const id = typeof row.CourseID === 'string' ? row.CourseID : ''
    if (!id) continue
    const prev = agilityById.get(id)
    if (!prev) {
      agilityById.set(id, { ...row })
      continue
    }
    const medal = typeof row.HighestUnlockedMedal === 'number' ? row.HighestUnlockedMedal : 0
    const prevMedal = typeof prev.HighestUnlockedMedal === 'number' ? prev.HighestUnlockedMedal : 0
    const time = typeof row.PersonalBestCompletionTime === 'number' ? row.PersonalBestCompletionTime : undefined
    const prevTime = typeof prev.PersonalBestCompletionTime === 'number' ? prev.PersonalBestCompletionTime : undefined
    agilityById.set(id, {
      ...prev,
      HighestUnlockedMedal: Math.max(medal, prevMedal),
      PersonalBestCompletionTime: time == null ? prevTime : prevTime == null ? time : Math.min(time, prevTime),
    })
  }
  const knownCourseIds = new Set(agilityCourses.map((course) => course.id))
  const courseIds = [
    ...agilityCourses.map((course) => course.id),
    ...[...agilityById.keys()].filter((id) => !knownCourseIds.has(id)),
  ]

  const vendorTags = [
    ...vendors.map((vendor) => vendor.tag),
    ...reps
      .map((rep) => (typeof rep.VendorReputationTag === 'string' ? rep.VendorReputationTag : ''))
      .filter((tag) => tag && !vendors.some((vendor) => vendor.tag === tag)),
  ]

  function setVendorAmount(tag: string, amount: number) {
    patch((block) => {
      const list = Array.isArray(block.VendorReputations)
        ? block.VendorReputations.filter(isObject).map((row) => ({ ...row }))
        : []
      const index = list.findIndex((row) => row.VendorReputationTag === tag)
      if (index >= 0) list[index] = { ...list[index], VendorReputationAmount: amount }
      else list.push({ VendorReputationTag: tag, VendorReputationAmount: amount })
      block.VendorReputations = list
    })
  }

  function setAgility(courseId: string, field: 'HighestUnlockedMedal' | 'PersonalBestCompletionTime', value: number) {
    patch((block) => {
      const nextMap = new Map(agilityById)
      const existing = nextMap.get(courseId) ?? {
        CourseID: courseId,
        HighestUnlockedMedal: 0,
        PersonalBestCompletionTime: 0,
      }
      nextMap.set(courseId, { ...existing, CourseID: courseId, [field]: value })
      block.AgilityCourseScores = [...nextMap.values()]
    })
  }

  const showRecipes = hasKey(progress, 'RecipesUnlocked') || hasKey(progress, 'RecipesNew')
  const showBuildings = hasKey(progress, 'BuildingsUnlocked') || hasKey(progress, 'BuildingPiecesNew') || hasKey(progress, 'BuildingsFavourited')
  const showSpells = hasKey(progress, 'SpellsUnlocked') || hasKey(progress, 'SpellsNew')
  const showDiscovery = hasKey(progress, 'ItemsPickedUp') || hasKey(progress, 'MilestoneMaterialsPickedUp')
  const showWorld = hasKey(progress, 'VendorReputations')
    || hasKey(progress, 'AgilityCourseScores')
    || hasKey(progress, 'ShrinesUnlocked')
    || hasKey(progress, 'KebbitBurrowsFound')
    || hasKey(progress, 'KebbitBurrowsActivated')
  const showAdvanced = hasKey(progress, 'ActorsInteractedWith')
    || hasKey(progress, 'PlayerHooksTriggered')
    || hasKey(progress, 'KilledOnceAIs')

  const unlockedRecipes = getStringArray(progress.RecipesUnlocked)
  const newRecipes = getStringArray(progress.RecipesNew)
  const journalRecipeIds = new Set(journalRecipes().map((recipe) => recipe.id))
  const craftEntries = craftingRecipes()
  const journalEntries = journalRecipes()

  return (
    <section className="panel stack">
      <h2>Progress</h2>

      {showRecipes ? (
        <>
          <UnlockCatalog
            title="Recipes"
            description="Crafting recipes in the crafting menu."
            entries={craftEntries}
            unlocked={unlockedRecipes.filter((id) => !journalRecipeIds.has(id))}
            newIds={newRecipes.filter((id) => !journalRecipeIds.has(id))}
            onChange={({ unlocked, newIds }) => mergeRecipeLists(
              (id) => !journalRecipeIds.has(id),
              unlocked,
              newIds,
            )}
            resolveIcon={(entry) => recipeIcon(getRecipe(entry.id) ?? { id: entry.id, name: entry.name })}
          />
          {journalEntries.length > 0 ? (
            <UnlockCatalog
              title="Item journal"
              description="Material and food pages unlocked in the journal."
              entries={journalEntries.map((recipe) => ({
                id: recipe.id,
                name: recipe.name,
                category: recipe.category,
              }))}
              unlocked={unlockedRecipes.filter((id) => journalRecipeIds.has(id))}
              newIds={newRecipes.filter((id) => journalRecipeIds.has(id))}
              onChange={({ unlocked, newIds }) => mergeRecipeLists(
                (id) => journalRecipeIds.has(id),
                unlocked,
                newIds,
              )}
              resolveIcon={(entry) => recipeIcon(getRecipe(entry.id) ?? { id: entry.id, name: entry.name })}
            />
          ) : null}
        </>
      ) : null}

      {showBuildings ? (
        <UnlockCatalog
          title="Buildings"
          description="Pieces available in the build menu."
          entries={buildings}
          unlocked={getStringArray(progress.BuildingsUnlocked)}
          newIds={getStringArray(progress.BuildingPiecesNew)}
          favourites={getStringArray(progress.BuildingsFavourited)}
          onChange={({ unlocked, newIds, favourites }) => setLists({
            BuildingsUnlocked: unlocked,
            ...(newIds ? { BuildingPiecesNew: newIds } : {}),
            ...(favourites ? { BuildingsFavourited: favourites } : {}),
          })}
          iconFolder="buildings"
        />
      ) : null}

      {showSpells ? (
        <UnlockCatalog
          title="Spells"
          description="Utility spells in the spellbook. The equipped bar is on the Spells page."
          entries={catalogSpells}
          unlocked={getStringArray(progress.SpellsUnlocked)}
          newIds={getStringArray(progress.SpellsNew)}
          onChange={({ unlocked, newIds }) => setLists({
            SpellsUnlocked: unlocked,
            ...(newIds ? { SpellsNew: newIds } : {}),
          })}
          iconFolder="spells"
        />
      ) : null}

      {showDiscovery ? (
        <Collapsible
          title="Discovery"
          description="First pickup of items and milestone materials."
        >
          {hasKey(progress, 'ItemsPickedUp') ? (
            <ItemIdList
              title="Items picked up"
              values={getStringArray(progress.ItemsPickedUp)}
              onChange={(values) => setList('ItemsPickedUp', values)}
            />
          ) : null}
          {hasKey(progress, 'MilestoneMaterialsPickedUp') ? (
            <ItemIdList
              title="Milestone materials"
              values={getStringArray(progress.MilestoneMaterialsPickedUp)}
              onChange={(values) => setList('MilestoneMaterialsPickedUp', values)}
            />
          ) : null}
        </Collapsible>
      ) : null}

      {showWorld ? (
        <Collapsible
          title="World"
          description="Vendors, agility courses, shrines, and kebbit burrows."
        >
          {hasKey(progress, 'VendorReputations') || vendors.length > 0 ? (
            <>
              <h4>Vendors</h4>
              <div className="form-grid">
                {vendorTags.map((tag) => {
                  const current = reps.find((rep) => rep.VendorReputationTag === tag)
                  const amount = typeof current?.VendorReputationAmount === 'number' ? current.VendorReputationAmount : 0
                  return (
                    <label key={tag}>
                      {vendorLabel(tag)}
                      <input
                        type="number"
                        min={0}
                        value={amount}
                        onChange={(event) => setVendorAmount(tag, Number(event.target.value))}
                      />
                    </label>
                  )
                })}
              </div>
            </>
          ) : null}

          {hasKey(progress, 'AgilityCourseScores') || agilityCourses.length > 0 ? (
            <>
              <h4>Agility courses</h4>
              <table className="data-table">
                <thead>
                  <tr><th>Course</th><th>Medal</th><th>Best time</th></tr>
                </thead>
                <tbody>
                  {courseIds.map((id) => {
                    const row = agilityById.get(id)
                    return (
                      <tr key={id}>
                        <td>{agilityLabel(id) || id}</td>
                        <td>
                          <select
                            value={typeof row?.HighestUnlockedMedal === 'number' ? row.HighestUnlockedMedal : 0}
                            onChange={(event) => setAgility(id, 'HighestUnlockedMedal', Number(event.target.value))}
                          >
                            {AGILITY_MEDALS.map((medal) => (
                              <option key={medal.value} value={medal.value}>{medal.label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={typeof row?.PersonalBestCompletionTime === 'number' ? row.PersonalBestCompletionTime : 0}
                            onChange={(event) => setAgility(id, 'PersonalBestCompletionTime', Number(event.target.value))}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          ) : null}

          {hasKey(progress, 'ShrinesUnlocked') ? (
            <IdListEditor
              mode="raw"
              title="Shrines unlocked"
              values={getStringArray(progress.ShrinesUnlocked)}
              onChange={(values) => setList('ShrinesUnlocked', values)}
            />
          ) : null}
          {hasKey(progress, 'KebbitBurrowsFound') ? (
            <IdListEditor
              mode="raw"
              title="Kebbit burrows found"
              values={getStringArray(progress.KebbitBurrowsFound)}
              onChange={(values) => setList('KebbitBurrowsFound', values)}
            />
          ) : null}
          {hasKey(progress, 'KebbitBurrowsActivated') ? (
            <IdListEditor
              mode="raw"
              title="Kebbit burrows activated"
              values={getStringArray(progress.KebbitBurrowsActivated)}
              onChange={(values) => setList('KebbitBurrowsActivated', values)}
            />
          ) : null}
        </Collapsible>
      ) : null}

      {showAdvanced ? (
        <Collapsible
          title="Advanced"
          description="One-shot actors, player hooks, and first-kill AI records."
        >
          {hasKey(progress, 'ActorsInteractedWith') ? (
            <NamedIdList
              title="Actors interacted with"
              values={getStringArray(progress.ActorsInteractedWith)}
              label={actorLabel}
              onChange={(values) => setList('ActorsInteractedWith', values)}
            />
          ) : null}
          {hasKey(progress, 'PlayerHooksTriggered') ? (
            <UnlockCatalog
              title="Player hooks"
              description="One-shot tutorial and world hooks that have already fired."
              entries={hooks}
              unlocked={getStringArray(progress.PlayerHooksTriggered)}
              onChange={({ unlocked }) => setList('PlayerHooksTriggered', unlocked)}
            />
          ) : null}
          {hasKey(progress, 'KilledOnceAIs') ? (
            <UnlockCatalog
              title="Killed-once AIs"
              description="Creatures recorded as killed at least once."
              entries={ais}
              unlocked={getStringArray(progress.KilledOnceAIs)}
              onChange={({ unlocked }) => setList('KilledOnceAIs', unlocked)}
            />
          ) : null}
        </Collapsible>
      ) : null}
    </section>
  )
}

function NamedIdList({
  title,
  values,
  onChange,
  label,
}: {
  title: string
  values: string[]
  onChange: (next: string[]) => void
  label: (id: string) => string
}) {
  const [draft, setDraft] = useState('')
  function add() {
    const id = draft.trim()
    if (!id || values.includes(id)) return
    onChange([...values, id])
    setDraft('')
  }
  return (
    <div className="id-list">
      <div className="id-list-head">
        <h3>{title}</h3>
        <span className="muted">{values.length}</span>
      </div>
      <ul className="id-values">
        {values.map((id) => (
          <li key={id}>
            <span title={id}>{label(id)}</span>
            <button type="button" className="linkish" onClick={() => onChange(values.filter((entry) => entry !== id))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="inline-add">
        <input
          placeholder="Add id"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') add() }}
        />
        <button type="button" onClick={add}>Add</button>
      </div>
    </div>
  )
}

function actorLabel(id: string): string {
  return id.replace(/^BP_/, '').replace(/_C$/, '').replace(/_/g, ' ')
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasKey(obj: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}
