import { useEffect, useMemo, useRef, useState } from 'react'
import { Collapsible } from '../components/Collapsible'
import { PinTypePicker } from '../components/PinTypePicker'
import { WorldMapViewer, pinFromRow } from '../components/WorldMapViewer'
import {
  DEFAULT_MAPGENIE_CONTENT_UV,
  mapRegions,
  mapResourceGroups,
  mapResourceMarkers,
  mapResourcesCalibration,
  mapMarkerUrl,
} from '../catalog'
import {
  isRegionRevealed,
  regionGroupState,
  setRegionBit,
  setRegionBits,
} from '../map/projection'
import { MAP_CALIBRATION_DEBUG } from '../map/calibrationDebug'
import { PIN_TYPES } from '../saves/lookups'
import { asObject, getBool, getGameplayRoot, getNumber, getStringArray } from '../saves/access'
import type {
  JsonObject,
  JsonValue,
  MapRegionInfo,
  MapResourceCategory,
  MapgenieContentUv,
} from '../saves/types'

const REGION_GROUP_ORDER = [
  'Brynmoor',
  'Ghornfell',
  'Fellhollow',
  'Dowdun Reach',
  'Umbral Sands',
  'Scorned Wilderness',
]

const RESOURCE_STORAGE_KEY = 'rsdw.map.resourceCategories'
const CONTENT_UV_STORAGE_KEY = 'rsdw.map.contentUv'
const CUSTOM_PINS_GROUP_ID = 'custom-pins'

function customPinCategoryId(pinType: number): string {
  return `custom-pin-${pinType}`
}

const CUSTOM_PIN_CATEGORIES: MapResourceCategory[] = PIN_TYPES.map((type) => ({
  id: customPinCategoryId(type.value),
  title: type.label,
  iconKey: type.icon,
  defaultOn: true,
}))

function isContentUv(value: unknown): value is MapgenieContentUv {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.u0 === 'number'
    && typeof row.v0 === 'number'
    && typeof row.u1 === 'number'
    && typeof row.v1 === 'number'
    && row.u1 > row.u0
    && row.v1 > row.v0
  )
}

function catalogContentUv(): MapgenieContentUv {
  const fromCatalog = mapResourcesCalibration?.mapgenieContentUv
  return isContentUv(fromCatalog) ? fromCatalog : DEFAULT_MAPGENIE_CONTENT_UV
}

function loadContentUv(): MapgenieContentUv {
  try {
    const raw = localStorage.getItem(CONTENT_UV_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (isContentUv(parsed)) return parsed
    }
  } catch {
    // ignore
  }
  return catalogContentUv()
}

function formatContentUv(content: MapgenieContentUv): string {
  return [
    'const MG_CONTENT = {',
    `  u0: ${content.u0},`,
    `  v0: ${content.v0},`,
    `  u1: ${content.u1},`,
    `  v1: ${content.v1},`,
    '}',
  ].join('\n')
}

const CALIB_PANES: { title: string; focus: { u: number; v: number; scale: number } }[] = [
  { title: 'West · abbey', focus: { u: 0.07, v: 0.71, scale: 3.4 } },
  { title: 'Center', focus: { u: 0.48, v: 0.52, scale: 2.6 } },
  { title: 'East', focus: { u: 0.78, v: 0.42, scale: 3.0 } },
]

type Props = {
  save: JsonObject
  onChange: (save: JsonObject) => void
}

export function MapSection({ save, onChange }: Props) {
  const root = getGameplayRoot(save)
  const fog = asObject(root.RevealedFog) ?? {}
  const landmarks = asObject(root.RevealedLandmarks) ?? {}
  const map = asObject(root.MapCustomization) ?? {}
  const pins = Array.isArray(map.Pins) ? map.Pins.filter(isObject) : []
  const bitmap = getNumber(fog, 'RevealedRegionsBitmap')
  const [selectedPin, setSelectedPin] = useState<number | null>(null)
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())
  const [openResourceGroups, setOpenResourceGroups] = useState<Set<string>>(
    () => new Set([CUSTOM_PINS_GROUP_ID]),
  )
  const [enabledCategories, setEnabledCategories] = useState<Set<string>>(() => loadEnabledCategories())
  const [contentUv, setContentUv] = useState<MapgenieContentUv>(() => (
    MAP_CALIBRATION_DEBUG ? loadContentUv() : catalogContentUv()
  ))
  const [copyFlash, setCopyFlash] = useState(false)
  const [showDebugOverlay, setShowDebugOverlay] = useState(MAP_CALIBRATION_DEBUG)
  const [multiPane, setMultiPane] = useState(MAP_CALIBRATION_DEBUG)

  useEffect(() => {
    setEnabledCategories((prev) => mergeWithKnownCategories(prev))
  }, [mapResourceGroups.length])

  useEffect(() => {
    try {
      localStorage.setItem(RESOURCE_STORAGE_KEY, JSON.stringify([...enabledCategories]))
    } catch {
      // ignore quota / private mode
    }
  }, [enabledCategories])

  useEffect(() => {
    if (!MAP_CALIBRATION_DEBUG) return
    try {
      localStorage.setItem(CONTENT_UV_STORAGE_KEY, JSON.stringify(contentUv))
    } catch {
      // ignore
    }
  }, [contentUv])

  function patchContentUv(patch: Partial<MapgenieContentUv>) {
    setContentUv((prev) => {
      const next = { ...prev, ...patch }
      if (!(next.u1 > next.u0 && next.v1 > next.v0)) return prev
      return next
    })
  }

  async function copyContentUv() {
    const text = formatContentUv(contentUv)
    try {
      await navigator.clipboard.writeText(text)
      setCopyFlash(true)
      window.setTimeout(() => setCopyFlash(false), 1500)
    } catch {
      // ignore
    }
  }
  function patchFog(key: string, value: JsonValue) {
    const next = structuredClone(save)
    const block = asObject(getGameplayRoot(next).RevealedFog) ?? {}
    block[key] = value
    getGameplayRoot(next).RevealedFog = block
    onChange(next)
  }

  function patchPins(list: JsonValue[]) {
    const next = structuredClone(save)
    const block = asObject(getGameplayRoot(next).MapCustomization) ?? {}
    block.Pins = list
    getGameplayRoot(next).MapCustomization = block
    onChange(next)
  }

  function updatePin(index: number, pin: JsonObject) {
    const list = pins.map((row) => ({ ...row }))
    list[index] = pin
    patchPins(list)
  }

  function toggleGroupOpen(name: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function toggleResourceGroupOpen(id: string) {
    setOpenResourceGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function setCategoryEnabled(id: string, on: boolean) {
    setEnabledCategories((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function setCategoriesEnabled(ids: string[], on: boolean) {
    setEnabledCategories((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  const viewerPins = pins.map((row) => pinFromRow(row)).filter((pin): pin is NonNullable<typeof pin> => pin !== null)
  const revealedCount = mapRegions.filter((region) => isRegionRevealed(bitmap, region.bit)).length
  const regionGroups = useMemo(() => groupMapRegions(mapRegions), [])
  const allBits = useMemo(() => mapRegions.map((region) => region.bit), [])
  const categoryColors = useMemo(() => {
    const mapColors = new Map<string, string>()
    for (const group of mapResourceGroups) {
      for (const category of group.categories) {
        if (category.color) mapColors.set(category.id, category.color)
      }
    }
    return mapColors
  }, [])
  const pinTypeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const pin of viewerPins) {
      const id = customPinCategoryId(pin.PinType)
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [viewerPins])
  const markerCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const marker of mapResourceMarkers) {
      counts.set(marker.categoryId, (counts.get(marker.categoryId) ?? 0) + 1)
    }
    return counts
  }, [])
  const enabledPinTypes = useMemo(() => {
    const next = new Set<number>()
    for (const type of PIN_TYPES) {
      if (enabledCategories.has(customPinCategoryId(type.value))) next.add(type.value)
    }
    return next
  }, [enabledCategories])
  const enabledMarkerCount = useMemo(() => {
    let n = 0
    for (const marker of mapResourceMarkers) {
      if (enabledCategories.has(marker.categoryId)) n += 1
    }
    for (const pin of viewerPins) {
      if (enabledPinTypes.has(pin.PinType)) n += 1
    }
    return n
  }, [enabledCategories, enabledPinTypes, viewerPins])
  const allCategoryIds = useMemo(() => [...knownCategoryIds()], [mapResourceGroups.length])
  const sidebarGroups = useMemo(() => {
    const custom = {
      id: CUSTOM_PINS_GROUP_ID,
      title: 'Custom Pins',
      categories: CUSTOM_PIN_CATEGORIES,
    }
    return [custom, ...mapResourceGroups]
  }, [mapResourceGroups.length])

  return (
    <section className="panel map-page">
      <h2>Map - Ashenfall</h2>
      <p className="muted map-viewer-desc">
        Interactive map using the in-game landmass. Click to drop a pin, middle-click to delete. Toggle resource layers below.
      </p>

      <div className={MAP_CALIBRATION_DEBUG && multiPane ? 'map-ashenfall-layout multipane' : 'map-ashenfall-layout'}>
        <div className={MAP_CALIBRATION_DEBUG && multiPane ? 'map-viewer-panes' : 'map-viewer-panes single'}>
          {(MAP_CALIBRATION_DEBUG && multiPane
            ? CALIB_PANES
            : [{ title: 'Ashenfall', focus: undefined }]
          ).map((pane) => (
            <WorldMapViewer
              key={MAP_CALIBRATION_DEBUG && multiPane ? pane.title : 'single'}
              pins={viewerPins}
              revealedBitmap={bitmap}
              selectedIndex={selectedPin}
              enabledCategories={enabledCategories}
              enabledPinTypes={enabledPinTypes}
              categoryColors={categoryColors}
              contentUv={MAP_CALIBRATION_DEBUG ? contentUv : undefined}
              showDebugOverlay={MAP_CALIBRATION_DEBUG && showDebugOverlay}
              compact={MAP_CALIBRATION_DEBUG && multiPane}
              title={MAP_CALIBRATION_DEBUG && multiPane ? pane.title : undefined}
              initialFocus={MAP_CALIBRATION_DEBUG && multiPane ? pane.focus : undefined}
              onSelect={setSelectedPin}
              onAddPin={(x, y, type) => {
                setCategoryEnabled(customPinCategoryId(type), true)
                patchPins([...pins, { PinType: type, PinLocation: [x, y] }])
                setSelectedPin(pins.length)
              }}
              onRemovePin={(pinIndex) => {
                patchPins(pins.filter((_, i) => i !== pinIndex))
                setSelectedPin((prev) => {
                  if (prev === null) return null
                  if (prev === pinIndex) return null
                  if (prev > pinIndex) return prev - 1
                  return prev
                })
              }}
            />
          ))}
        </div>

        <aside className="map-resource-sidebar">
          {MAP_CALIBRATION_DEBUG ? (
            <details className="map-calib-panel" open>
              <summary>Marker calibration</summary>
              <p className="muted map-calib-hint">
                Live MapGenie → landmass content UV. Three panes share these values; pan/zoom each independently.
              </p>
              <CalibSlider
                label="West u0"
                value={contentUv.u0}
                min={0.25}
                max={0.45}
                onChange={(u0) => patchContentUv({ u0 })}
              />
              <CalibSlider
                label="North v0"
                value={contentUv.v0}
                min={0.1}
                max={0.35}
                onChange={(v0) => patchContentUv({ v0 })}
              />
              <CalibSlider
                label="East u1"
                value={contentUv.u1}
                min={0.8}
                max={0.98}
                onChange={(u1) => patchContentUv({ u1 })}
              />
              <CalibSlider
                label="South v1"
                value={contentUv.v1}
                min={0.65}
                max={0.9}
                onChange={(v1) => patchContentUv({ v1 })}
              />
              <div className="map-calib-actions">
                <button type="button" onClick={() => setContentUv(catalogContentUv())}>
                  Reset
                </button>
                <button type="button" onClick={() => void copyContentUv()}>
                  {copyFlash ? 'Copied' : 'Copy MG_CONTENT'}
                </button>
                <button
                  type="button"
                  className={showDebugOverlay ? 'on' : undefined}
                  onClick={() => setShowDebugOverlay((prev) => !prev)}
                >
                  {showDebugOverlay ? 'Debug on' : 'Debug off'}
                </button>
                <button
                  type="button"
                  className={multiPane ? 'on' : undefined}
                  onClick={() => setMultiPane((prev) => !prev)}
                >
                  {multiPane ? '3 panes' : '1 pane'}
                </button>
              </div>
              <pre className="map-calib-code">{formatContentUv(contentUv)}</pre>
            </details>
          ) : null}
          <div className="map-region-toolbar">
            <button type="button" onClick={() => setCategoriesEnabled(allCategoryIds, true)}>
              Show all
            </button>
            <button type="button" onClick={() => setCategoriesEnabled(allCategoryIds, false)}>
              Hide all
            </button>
            <button
              type="button"
              onClick={() => setEnabledCategories(defaultEnabledCategories())}
            >
              Defaults
            </button>
            <span className="muted">{enabledMarkerCount.toLocaleString()} shown</span>
          </div>
          <div className="map-region-tree map-resource-tree">
            {sidebarGroups.map((group) => {
              const open = openResourceGroups.has(group.id)
              const ids = group.categories.map((category) => category.id)
              const state = categoryGroupState(enabledCategories, ids)
              const onCount = ids.filter((id) => enabledCategories.has(id)).length
              const isCustomPins = group.id === CUSTOM_PINS_GROUP_ID
              return (
                <div key={group.id} className={open ? 'map-region-group open' : 'map-region-group'}>
                  <div className="map-region-parent">
                    <button
                      type="button"
                      className="map-region-expand"
                      aria-expanded={open}
                      onClick={() => toggleResourceGroupOpen(group.id)}
                    >
                      <Chevron />
                      <span className="map-region-parent-name">{group.title}</span>
                      <span className="muted">{onCount}/{ids.length}</span>
                    </button>
                    <TriStateCheckbox
                      state={state}
                      label={`Toggle all of ${group.title}`}
                      onChange={(on) => setCategoriesEnabled(ids, on)}
                    />
                  </div>
                  {open ? (
                    <ul className="map-region-children">
                      {group.categories.map((category) => (
                        <li key={category.id} className="map-region-child">
                          <CategorySwitch
                            category={category}
                            count={
                              isCustomPins
                                ? (pinTypeCounts.get(category.id) ?? 0)
                                : (markerCounts.get(category.id) ?? 0)
                            }
                            checked={enabledCategories.has(category.id)}
                            onToggle={() => setCategoryEnabled(
                              category.id,
                              !enabledCategories.has(category.id),
                            )}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )
            })}
          </div>
        </aside>
      </div>

      <Collapsible
        title="Discovered Regions"
        description="Toggle which overworld areas are revealed on the map fog."
        meta={mapRegions.length > 0 ? `${revealedCount}/${mapRegions.length}` : undefined}
      >
          {mapRegions.length > 0 ? (
            <>
              <div className="map-region-toolbar">
                <button
                  type="button"
                  onClick={() => patchFog('RevealedRegionsBitmap', setRegionBits(bitmap, allBits, true))}
                >
                  Reveal all
                </button>
                <button
                  type="button"
                  onClick={() => patchFog('RevealedRegionsBitmap', setRegionBits(bitmap, allBits, false))}
                >
                  Clear all
                </button>
                <Switch
                  label="Detection active"
                  checked={getBool(fog, 'RevealedRegionsDetectionActive', true)}
                  onToggle={() => patchFog(
                    'RevealedRegionsDetectionActive',
                    !getBool(fog, 'RevealedRegionsDetectionActive', true),
                  )}
                />
              </div>

              <div className="map-region-tree">
                {regionGroups.map((group) => {
                  const open = openGroups.has(group.name)
                  const state = regionGroupState(bitmap, group.regions)
                  const groupRevealed = group.regions.filter((region) => isRegionRevealed(bitmap, region.bit)).length
                  return (
                    <div key={group.name} className={open ? 'map-region-group open' : 'map-region-group'}>
                      <div className="map-region-parent">
                        <button
                          type="button"
                          className="map-region-expand"
                          aria-expanded={open}
                          onClick={() => toggleGroupOpen(group.name)}
                        >
                          <Chevron />
                          <span className="map-region-parent-name">{group.name}</span>
                          <span className="muted">{groupRevealed}/{group.regions.length}</span>
                        </button>
                        <TriStateCheckbox
                          state={state}
                          label={`Reveal all of ${group.name}`}
                          onChange={(on) => patchFog(
                            'RevealedRegionsBitmap',
                            setRegionBits(bitmap, group.regions.map((region) => region.bit), on),
                          )}
                        />
                      </div>
                      {open ? (
                        <ul className="map-region-children">
                          {group.regions.map((region) => {
                            const on = isRegionRevealed(bitmap, region.bit)
                            return (
                              <li key={region.id} className="map-region-child">
                                <Switch
                                  label={region.name}
                                  checked={on}
                                  onToggle={() => patchFog(
                                    'RevealedRegionsBitmap',
                                    setRegionBit(bitmap, region.bit, !on),
                                  )}
                                />
                              </li>
                            )
                          })}
                        </ul>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </>
          ) : null}

          <details className="map-region-advanced">
            <summary>Advanced</summary>
            <label>
              Revealed regions bitmap
              <input
                type="number"
                value={bitmap}
                onChange={(event) => patchFog('RevealedRegionsBitmap', Number(event.target.value))}
              />
            </label>
            <div className="map-region-landmarks">
              <h4>Landmarks</h4>
              <p className="muted map-viewer-desc">
                Named world POIs that stay hidden until discovered (map towers, shrines, burrows, agility courses, and similar). Empty until those names are revealed.
              </p>
              <textarea
                rows={4}
                value={getStringArray(landmarks.RevealedLandmarkNames).join('\n')}
                onChange={(event) => {
                  const next = structuredClone(save)
                  const block = asObject(getGameplayRoot(next).RevealedLandmarks) ?? {}
                  block.RevealedLandmarkNames = event.target.value.split('\n').map((line) => line.trim()).filter(Boolean)
                  getGameplayRoot(next).RevealedLandmarks = block
                  onChange(next)
                }}
              />
            </div>
          </details>
        </Collapsible>

      <Collapsible title="Custom Pins" meta={`${pins.length}`}>
        {pins.map((pin, index) => {
          const loc = Array.isArray(pin.PinLocation) ? pin.PinLocation : [0, 0]
          return (
            <div
              key={index}
              className={index === selectedPin ? 'map-pin-row on' : 'map-pin-row'}
              onClick={() => setSelectedPin(index)}
            >
              <div className="map-pin-field">
                <span>Type</span>
                <PinTypePicker
                  value={typeof pin.PinType === 'number' ? pin.PinType : 1}
                  onChange={(type) => updatePin(index, { ...pin, PinType: type })}
                />
              </div>
              <label className="map-pin-field">
                X
                <input
                  type="number"
                  value={typeof loc[0] === 'number' ? loc[0] : 0}
                  onChange={(event) => updatePin(index, { ...pin, PinLocation: [Number(event.target.value), Number(loc[1] ?? 0)] })}
                />
              </label>
              <label className="map-pin-field">
                Y
                <input
                  type="number"
                  value={typeof loc[1] === 'number' ? loc[1] : 0}
                  onChange={(event) => updatePin(index, { ...pin, PinLocation: [Number(loc[0] ?? 0), Number(event.target.value)] })}
                />
              </label>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  patchPins(pins.filter((_, i) => i !== index))
                  if (selectedPin === index) setSelectedPin(null)
                }}
              >
                Remove
              </button>
            </div>
          )
        })}
        <button
          type="button"
          onClick={() => {
            patchPins([...pins, { PinType: 1, PinLocation: [0, 0] }])
          }}
        >
          Add pin
        </button>
      </Collapsible>
    </section>
  )
}

function CalibSlider({
  label,
  value,
  min,
  max,
  step = 0.0005,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (next: number) => void
}) {
  return (
    <label className="map-calib-slider">
      <span className="map-calib-slider-head">
        <span>{label}</span>
        <input
          type="number"
          step={step}
          min={min}
          max={max}
          value={Number(value.toFixed(4))}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) onChange(next)
          }}
        />
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function CategorySwitch({
  category,
  count,
  checked,
  onToggle,
}: {
  category: MapResourceCategory
  count: number
  checked: boolean
  onToggle: () => void
}) {
  const icon = mapMarkerUrl(category.iconKey ?? undefined)
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={checked ? 'switch on map-region-switch map-resource-switch' : 'switch map-region-switch map-resource-switch'}
      onClick={onToggle}
    >
      <span className="map-resource-switch-main">
        {icon ? (
          <span
            className="map-resource-cat-icon-wrap"
            style={{ background: category.color || 'var(--gold)' }}
          >
            <img className="map-resource-cat-icon" src={icon} alt="" draggable={false} />
          </span>
        ) : (
          <span
            className="map-resource-cat-dot"
            style={{ background: category.color || 'var(--gold)' }}
          />
        )}
        <span className="switch-label">{category.title}</span>
        <span className="muted map-resource-count">{count}</span>
      </span>
      <span className="switch-track" aria-hidden>
        <span className="switch-thumb" />
      </span>
    </button>
  )
}

function Switch({
  label,
  checked,
  onToggle,
}: {
  label: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={checked ? 'switch on map-region-switch' : 'switch map-region-switch'}
      onClick={onToggle}
    >
      <span className="switch-label">{label}</span>
      <span className="switch-track" aria-hidden>
        <span className="switch-thumb" />
      </span>
    </button>
  )
}

function TriStateCheckbox({
  state,
  label,
  onChange,
}: {
  state: 'all' | 'some' | 'none'
  label: string
  onChange: (on: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some'
  }, [state])

  return (
    <input
      ref={ref}
      type="checkbox"
      className="map-region-tri"
      checked={state === 'all'}
      aria-label={label}
      title={label}
      onClick={(event) => event.stopPropagation()}
      onChange={() => onChange(state !== 'all')}
    />
  )
}

function Chevron() {
  return (
    <svg
      className="map-region-chevron"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
    >
      <path
        d="M2 4l4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function groupMapRegions(regions: MapRegionInfo[]): { name: string; regions: MapRegionInfo[] }[] {
  const byGroup = new Map<string, MapRegionInfo[]>()
  for (const region of regions) {
    const name = region.group?.trim() || 'Other'
    const list = byGroup.get(name) ?? []
    list.push(region)
    byGroup.set(name, list)
  }
  const ordered: { name: string; regions: MapRegionInfo[] }[] = []
  for (const name of REGION_GROUP_ORDER) {
    const list = byGroup.get(name)
    if (!list) continue
    ordered.push({ name, regions: list })
    byGroup.delete(name)
  }
  for (const [name, list] of byGroup) {
    ordered.push({ name, regions: list })
  }
  return ordered
}

function categoryGroupState(enabled: Set<string>, ids: string[]): 'all' | 'some' | 'none' {
  if (ids.length === 0) return 'none'
  let on = 0
  for (const id of ids) {
    if (enabled.has(id)) on += 1
  }
  if (on === 0) return 'none'
  if (on === ids.length) return 'all'
  return 'some'
}

function knownCategoryIds(): Set<string> {
  const next = new Set<string>()
  for (const category of CUSTOM_PIN_CATEGORIES) next.add(category.id)
  for (const group of mapResourceGroups) {
    for (const category of group.categories) next.add(category.id)
  }
  return next
}

function defaultEnabledCategories(): Set<string> {
  const next = new Set<string>()
  for (const category of CUSTOM_PIN_CATEGORIES) {
    if (category.defaultOn) next.add(category.id)
  }
  for (const group of mapResourceGroups) {
    for (const category of group.categories) {
      if (category.defaultOn) next.add(category.id)
    }
  }
  return next
}

function mergeWithKnownCategories(prev: Set<string>): Set<string> {
  const known = knownCategoryIds()
  if (known.size === 0) return prev
  const next = new Set([...prev].filter((id) => known.has(id)))
  const hadAnyCustom = [...prev].some((id) => id.startsWith('custom-pin-'))
  if (!hadAnyCustom) {
    for (const category of CUSTOM_PIN_CATEGORIES) {
      if (category.defaultOn) next.add(category.id)
    }
  }
  if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev
  return next.size > 0 ? next : defaultEnabledCategories()
}

function loadEnabledCategories(): Set<string> {
  try {
    const raw = localStorage.getItem(RESOURCE_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        const ids = parsed.filter((id): id is string => typeof id === 'string')
        return mergeWithKnownCategories(new Set(ids))
      }
    }
  } catch {
    // fall through to defaults
  }
  return defaultEnabledCategories()
}
