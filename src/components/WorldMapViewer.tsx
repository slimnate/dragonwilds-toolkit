import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PinTypePicker } from './PinTypePicker'
import {
  DEFAULT_MAPGENIE_CONTENT_UV,
  mapBounds,
  mapImageUrl,
  mapMarkerUrl,
  mapResourceMarkers,
  mapResourcesCalibration,
} from '../catalog'
import { loadRegionMask, paintFogOverlay } from '../map/fog'
import {
  landUvToMapgenieCrs,
  mapgenieCrsFrameOnLand,
  mapgenieCrsToLatLng,
  mapgenieLatLngToWorld,
  uvToWorld,
  worldToUv,
} from '../map/projection'
import { MAP_CALIBRATION_DEBUG } from '../map/calibrationDebug'
import { pinTypeInfo } from '../saves/lookups'
import type { JsonObject, MapResourceMarker, MapgenieContentUv } from '../saves/types'
import { DEFAULT_UNDERGROUND_UV } from '../map/undergroundOverlay'

type Pin = {
  PinType: number
  PinLocation: [number, number]
}

type MapFocus = {
  u: number
  v: number
  scale?: number
}

type Props = {
  pins: Pin[]
  revealedBitmap: number
  selectedIndex: number | null
  enabledCategories: Set<string>
  enabledPinTypes: Set<number>
  categoryColors: Map<string, string>
  contentUv?: MapgenieContentUv
  showDebugOverlay?: boolean
  /** Compact chrome for multi-pane calibration layouts. */
  compact?: boolean
  title?: string
  /** Center the camera on this landmass UV once the image is sized. */
  initialFocus?: MapFocus
  onSelect: (index: number | null) => void
  onAddPin: (x: number, y: number, type: number) => void
  onRemovePin: (index: number) => void
}

type HoveredResource = {
  marker: MapResourceMarker
  screenX: number
  screenY: number
}

type PlacedMarker = {
  marker: MapResourceMarker
  x: number
  y: number
}

type CursorDebug = {
  screenX: number
  screenY: number
  u: number
  v: number
  x: number
  y: number
  uCrs: number
  vCrs: number
  lat: number
  lng: number
}

/** Keep resource markers ~this many CSS pixels on screen at every zoom. */
const ICON_SCREEN_PX = 26
const HIT_RADIUS = 14

const FALLBACK_MG_BOUNDS: [number, number, number, number] = [-1.4, 0, 0, 1.4]

/** Pre-pad tile measurement (before live calibration expand). */
const TILE_MEASURED_CONTENT: MapgenieContentUv = {
  u0: 0.35546875,
  v0: 0.21484375,
  u1: 0.8984375,
  v1: 0.76171875,
}

function mgBounds(): [number, number, number, number] {
  return mapResourcesCalibration?.mapgenieBounds ?? FALLBACK_MG_BOUNDS
}

function projectMarker(marker: MapResourceMarker, contentUv: MapgenieContentUv): { x: number; y: number } {
  if (
    marker.source === 'mapgenie'
    && typeof marker.lat === 'number'
    && typeof marker.lng === 'number'
  ) {
    return mapgenieLatLngToWorld(marker.lat, marker.lng, mgBounds(), contentUv, mapBounds)
  }
  return { x: marker.x, y: marker.y }
}

function landToScreen(
  u: number,
  v: number,
  cam: { x: number; y: number; scale: number },
  imgSize: { w: number; h: number },
) {
  return {
    x: cam.x + u * imgSize.w * cam.scale,
    y: cam.y + v * imgSize.h * cam.scale,
  }
}

export function WorldMapViewer({
  pins,
  revealedBitmap,
  selectedIndex,
  enabledCategories,
  enabledPinTypes,
  categoryColors,
  contentUv = DEFAULT_MAPGENIE_CONTENT_UV,
  showDebugOverlay = false,
  compact = false,
  title,
  initialFocus,
  onSelect,
  onAddPin,
  onRemovePin,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const fogRef = useRef<HTMLCanvasElement>(null)
  const resourceRef = useRef<HTMLCanvasElement>(null)
  const debugRef = useRef<HTMLCanvasElement>(null)
  const iconCache = useRef(new Map<string, HTMLImageElement | null>())
  const [imgSize, setImgSize] = useState({ w: 2048, h: 2048 })
  const [cam, setCam] = useState({ x: 0, y: 0, scale: 1 })
  const [placeType, setPlaceType] = useState(1)
  const [hovered, setHovered] = useState<HoveredResource | null>(null)
  const [cursorDebug, setCursorDebug] = useState<CursorDebug | null>(null)
  const drag = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    pinIndex?: number
    moved: boolean
  } | null>(null)

  const visibleMarkers = useMemo((): PlacedMarker[] => {
    if (enabledCategories.size === 0) return []
    const out: PlacedMarker[] = []
    for (const marker of mapResourceMarkers) {
      if (!enabledCategories.has(marker.categoryId)) continue
      const { x, y } = projectMarker(marker, contentUv)
      out.push({ marker, x, y })
    }
    return out
  }, [enabledCategories, contentUv])

  const startLodestone = useMemo(() => {
    let best: MapResourceMarker | null = null
    for (const marker of mapResourceMarkers) {
      if (marker.categoryId !== 'lodestone') continue
      if (typeof marker.lng !== 'number') continue
      if (!best || (typeof best.lng === 'number' && marker.lng < best.lng)) best = marker
    }
    return best
  }, [mapResourceMarkers.length])

  const fit = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const pad = 16
    const scale = Math.min(
      (el.clientWidth - pad) / imgSize.w,
      (el.clientHeight - pad) / imgSize.h,
      2,
    )
    setCam({
      scale,
      x: (el.clientWidth - imgSize.w * scale) / 2,
      y: (el.clientHeight - imgSize.h * scale) / 2,
    })
  }, [imgSize.h, imgSize.w])

  const focusOn = useCallback((focus: MapFocus) => {
    const el = viewportRef.current
    if (!el) return
    const scale = focus.scale ?? Math.max(2.2, Math.min(5, el.clientWidth / 280))
    setCam({
      scale,
      x: el.clientWidth / 2 - focus.u * imgSize.w * scale,
      y: el.clientHeight / 2 - focus.v * imgSize.h * scale,
    })
  }, [imgSize.h, imgSize.w])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    let framed = false
    const frame = () => {
      if (framed || el.clientWidth < 2 || el.clientHeight < 2) return
      framed = true
      if (initialFocus) focusOn(initialFocus)
      else fit()
    }
    frame()
    const ro = new ResizeObserver(() => frame())
    ro.observe(el)
    return () => ro.disconnect()
  }, [imgSize.w, imgSize.h, fit, focusOn, initialFocus])

  useEffect(() => {
    const canvas = fogRef.current
    if (!canvas) return
    let cancelled = false
    loadRegionMask(mapImageUrl('T_WorldMapRegions.png'))
      .then((mask) => {
        if (cancelled || fogRef.current !== canvas) return
        paintFogOverlay(canvas, mask, revealedBitmap)
      })
      .catch(() => {
        // Region mask is optional; the map still works without fog.
      })
    return () => {
      cancelled = true
    }
  }, [revealedBitmap])

  useEffect(() => {
    const canvas = resourceRef.current
    const viewport = viewportRef.current
    if (!canvas || !viewport) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cssW = viewport.clientWidth
    const cssH = viewport.clientHeight
    if (cssW < 1 || cssH < 1) return

    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const needed = new Set<string>()
    for (const placed of visibleMarkers) {
      if (placed.marker.iconKey) needed.add(placed.marker.iconKey)
    }

    let redrawScheduled = false
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)
      const size = ICON_SCREEN_PX
      for (const placed of visibleMarkers) {
        const { u, v } = worldToUv(placed.x, placed.y, mapBounds)
        const sx = cam.x + u * imgSize.w * cam.scale
        const sy = cam.y + v * imgSize.h * cam.scale
        if (sx < -size || sy < -size || sx > cssW + size || sy > cssH + size) continue
        const icon = placed.marker.iconKey ? iconCache.current.get(placed.marker.iconKey) : null
        const color = categoryColors.get(placed.marker.categoryId) || '#d4b06a'
        // MapGenie glyphs are white; paint a category-colored disc behind them.
        ctx.beginPath()
        ctx.fillStyle = color
        ctx.strokeStyle = 'rgba(0,0,0,0.75)'
        ctx.lineWidth = 1.25
        ctx.arc(sx, sy, size * 0.42, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        if (icon && icon.complete && icon.naturalWidth) {
          const iconSize = size * 0.72
          ctx.drawImage(icon, sx - iconSize / 2, sy - iconSize / 2, iconSize, iconSize)
        }
      }
    }

    const schedule = () => {
      if (redrawScheduled) return
      redrawScheduled = true
      requestAnimationFrame(() => {
        redrawScheduled = false
        draw()
      })
    }

    for (const key of needed) {
      if (iconCache.current.has(key)) continue
      iconCache.current.set(key, null)
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => {
        iconCache.current.set(key, img)
        schedule()
      }
      img.onerror = () => {
        iconCache.current.set(key, null)
        schedule()
      }
      img.src = mapMarkerUrl(key) || ''
    }
    draw()
  }, [visibleMarkers, imgSize.w, imgSize.h, cam.x, cam.y, cam.scale, categoryColors])

  useEffect(() => {
    const canvas = debugRef.current
    const viewport = viewportRef.current
    if (!canvas || !viewport) return
    if (!showDebugOverlay) {
      canvas.width = 0
      canvas.height = 0
      return
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cssW = viewport.clientWidth
    const cssH = viewport.clientHeight
    if (cssW < 1 || cssH < 1) return

    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    ctx.lineJoin = 'round'
    ctx.font = '11px ui-monospace, Consolas, monospace'

    const toScreen = (u: number, v: number) => landToScreen(u, v, cam, imgSize)

    const strokeRectUv = (
      u0: number,
      v0: number,
      u1: number,
      v1: number,
      color: string,
      dash: number[] = [],
      width = 1.5,
    ) => {
      const a = toScreen(u0, v0)
      const b = toScreen(u1, v1)
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.setLineDash(dash)
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
      ctx.restore()
    }

    const label = (text: string, u: number, v: number, color: string, dx = 4, dy = -4) => {
      const p = toScreen(u, v)
      ctx.fillStyle = color
      ctx.fillText(text, p.x + dx, p.y + dy)
    }

    // UV grid (0.25)
    ctx.save()
    ctx.strokeStyle = 'rgba(212, 176, 106, 0.22)'
    ctx.lineWidth = 1
    for (let t = 0; t <= 1.0001; t += 0.25) {
      const a = toScreen(t, 0)
      const b = toScreen(t, 1)
      const c = toScreen(0, t)
      const d = toScreen(1, t)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.moveTo(c.x, c.y)
      ctx.lineTo(d.x, d.y)
      ctx.stroke()
    }
    ctx.restore()

    // Landmass UV frame [0,1]
    strokeRectUv(0, 0, 1, 1, 'rgba(80, 220, 160, 0.95)', [], 2)
    label('land (0,0)', 0, 0, 'rgba(80, 220, 160, 0.95)', 6, 14)
    label('land (1,1)', 1, 1, 'rgba(80, 220, 160, 0.95)', -72, -6)

    // Center crosshair
    {
      const c = toScreen(0.5, 0.5)
      ctx.save()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(c.x - 18, c.y)
      ctx.lineTo(c.x + 18, c.y)
      ctx.moveTo(c.x, c.y - 18)
      ctx.lineTo(c.x, c.y + 18)
      ctx.stroke()
      ctx.restore()
      label('UV 0.5,0.5', 0.5, 0.5, 'rgba(255,255,255,0.7)', 8, -8)
    }

    // MapGenie full CRS [0,1] projected through live content (outside land when content is inset)
    const liveCrs = mapgenieCrsFrameOnLand(contentUv)
    strokeRectUv(liveCrs.u0, liveCrs.v0, liveCrs.u1, liveCrs.v1, 'rgba(255, 90, 180, 0.9)', [8, 5], 1.75)
    label('MG CRS (live content)', liveCrs.u0, liveCrs.v0, 'rgba(255, 90, 180, 0.95)', 6, 14)

    // Same CRS frame through tile-measured (pre-pad) content for comparison
    const tileCrs = mapgenieCrsFrameOnLand(TILE_MEASURED_CONTENT)
    strokeRectUv(tileCrs.u0, tileCrs.v0, tileCrs.u1, tileCrs.v1, 'rgba(120, 170, 255, 0.75)', [3, 4], 1.25)
    label('MG CRS (tile-measured)', tileCrs.u0, tileCrs.v0, 'rgba(120, 170, 255, 0.9)', 6, 28)

    // World origin if on/near map
    {
      const origin = worldToUv(0, 0, mapBounds)
      if (origin.u > -0.2 && origin.u < 1.2 && origin.v > -0.2 && origin.v < 1.2) {
        const p = toScreen(origin.u, origin.v)
        ctx.save()
        ctx.strokeStyle = '#ffcc66'
        ctx.fillStyle = '#ffcc66'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillText('world (0,0)', p.x + 8, p.y - 6)
        ctx.restore()
      }
    }

    // Starting lodestone: live vs tile-measured projection
    if (
      startLodestone
      && typeof startLodestone.lat === 'number'
      && typeof startLodestone.lng === 'number'
    ) {
      const live = mapgenieLatLngToWorld(
        startLodestone.lat,
        startLodestone.lng,
        mgBounds(),
        contentUv,
        mapBounds,
      )
      const tile = mapgenieLatLngToWorld(
        startLodestone.lat,
        startLodestone.lng,
        mgBounds(),
        TILE_MEASURED_CONTENT,
        mapBounds,
      )
      const liveUv = worldToUv(live.x, live.y, mapBounds)
      const tileUv = worldToUv(tile.x, tile.y, mapBounds)
      const livePt = toScreen(liveUv.u, liveUv.v)
      const tilePt = toScreen(tileUv.u, tileUv.v)

      ctx.save()
      ctx.strokeStyle = 'rgba(255, 90, 180, 0.95)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(tilePt.x, tilePt.y)
      ctx.lineTo(livePt.x, livePt.y)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = 'rgba(120, 170, 255, 0.95)'
      ctx.beginPath()
      ctx.arc(tilePt.x, tilePt.y, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillText('lode@tile', tilePt.x + 6, tilePt.y - 6)

      ctx.strokeStyle = 'rgba(255, 90, 180, 1)'
      ctx.beginPath()
      ctx.arc(livePt.x, livePt.y, 7, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = 'rgba(255, 90, 180, 1)'
      ctx.fillText('lode@live', livePt.x + 8, livePt.y + 4)
      ctx.restore()
    }

    // Legend
    const legendX = 10
    let legendY = 16
    const legendLine = (color: string, text: string, dash: number[] = []) => {
      ctx.save()
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = 2
      ctx.setLineDash(dash)
      ctx.beginPath()
      ctx.moveTo(legendX, legendY)
      ctx.lineTo(legendX + 22, legendY)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillText(text, legendX + 28, legendY + 3)
      ctx.restore()
      legendY += 14
    }
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(4, 4, 210, 78)
    legendLine('rgba(80, 220, 160, 0.95)', 'Landmass UV [0,1]')
    legendLine('rgba(255, 90, 180, 0.9)', 'MG CRS via live content', [8, 5])
    legendLine('rgba(120, 170, 255, 0.75)', 'MG CRS via tile-measured', [3, 4])
    legendLine('rgba(255,255,255,0.7)', 'Center + start lodestone')
  }, [showDebugOverlay, contentUv, cam.x, cam.y, cam.scale, imgSize.w, imgSize.h, startLodestone])

  useEffect(() => {
    if (!showDebugOverlay) setCursorDebug(null)
  }, [showDebugOverlay])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = event.clientX - rect.left
      const my = event.clientY - rect.top
      setCam((prev) => {
        const worldX = (mx - prev.x) / prev.scale
        const worldY = (my - prev.y) / prev.scale
        const next = Math.min(8, Math.max(0.15, prev.scale * (event.deltaY < 0 ? 1.12 : 0.89)))
        return { scale: next, x: mx - worldX * next, y: my - worldY * next }
      })
    }
    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', onWheelNative)
  }, [])

  function clientToUv(clientX: number, clientY: number) {
    const el = viewportRef.current
    if (!el) return { u: 0.5, v: 0.5 }
    const rect = el.getBoundingClientRect()
    const x = (clientX - rect.left - cam.x) / cam.scale
    const y = (clientY - rect.top - cam.y) / cam.scale
    return { u: x / imgSize.w, v: y / imgSize.h }
  }

  function findResourceAt(clientX: number, clientY: number): MapResourceMarker | null {
    if (visibleMarkers.length === 0) return null
    const el = viewportRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    const hit2 = HIT_RADIUS * HIT_RADIUS
    let best: MapResourceMarker | null = null
    let bestD = hit2
    for (const placed of visibleMarkers) {
      const { u, v } = worldToUv(placed.x, placed.y, mapBounds)
      const mx = cam.x + u * imgSize.w * cam.scale
      const my = cam.y + v * imgSize.h * cam.scale
      const dx = mx - sx
      const dy = my - sy
      const d = dx * dx + dy * dy
      if (d <= bestD) {
        bestD = d
        best = placed.marker
      }
    }
    return best
  }

  function onPointerDown(event: React.PointerEvent) {
    if (event.button === 1) {
      event.preventDefault()
      const target = event.target as HTMLElement
      const pinEl = target.closest('[data-pin]')
      if (!pinEl) return
      const pinIndex = Number(pinEl.getAttribute('data-pin'))
      if (Number.isNaN(pinIndex)) return
      onRemovePin(pinIndex)
      return
    }
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    const pinIndex = target.closest('[data-pin]')
      ? Number(target.closest('[data-pin]')?.getAttribute('data-pin'))
      : undefined
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // ignore
    }
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: cam.x,
      originY: cam.y,
      pinIndex,
      moved: false,
    }
    if (pinIndex !== undefined && !Number.isNaN(pinIndex)) onSelect(pinIndex)
  }

  function onPointerMove(event: React.PointerEvent) {
    const state = drag.current
    if (state && state.pointerId === event.pointerId) {
      const dx = event.clientX - state.startX
      const dy = event.clientY - state.startY
      if (!state.moved && dx * dx + dy * dy > 16) state.moved = true
      if (state.moved) {
        setCam((prev) => ({ ...prev, x: state.originX + dx, y: state.originY + dy }))
        setHovered(null)
        setCursorDebug(null)
        return
      }
    }

    const el = viewportRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const screenX = event.clientX - rect.left
    const screenY = event.clientY - rect.top

    if (showDebugOverlay) {
      const { u, v } = clientToUv(event.clientX, event.clientY)
      const world = uvToWorld(u, v, mapBounds)
      const { uCrs, vCrs } = landUvToMapgenieCrs(u, v, contentUv)
      const { lat, lng } = mapgenieCrsToLatLng(uCrs, vCrs, mgBounds())
      setCursorDebug({
        screenX,
        screenY,
        u,
        v,
        x: world.x,
        y: world.y,
        uCrs,
        vCrs,
        lat,
        lng,
      })
    }

    const marker = findResourceAt(event.clientX, event.clientY)
    if (!marker) {
      setHovered(null)
      return
    }
    setHovered({
      marker,
      screenX,
      screenY,
    })
  }

  function onPointerUp(event: React.PointerEvent) {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null
    if (state.moved) return
    if (state.pinIndex !== undefined) return
    if (findResourceAt(event.clientX, event.clientY)) return
    const { u, v } = clientToUv(event.clientX, event.clientY)
    if (u < 0 || v < 0 || u > 1 || v > 1) return
    const world = uvToWorld(u, v, mapBounds)
    onAddPin(world.x, world.y, placeType)
  }

  const landmass = mapImageUrl('T_WorldMap_Landmass.png')
  const sea = mapImageUrl('T_World_Map_Sea_Tile_Test2.png')
  const underground = mapImageUrl('T_Map_Dowdun_Underground.png')

  return (
    <div className={compact ? 'world-map compact' : 'world-map'}>
      <div className="world-map-toolbar">
        {title ? <span className="world-map-pane-title">{title}</span> : null}
        <button type="button" onClick={fit}>Fit</button>
        {initialFocus ? (
          <button type="button" onClick={() => focusOn(initialFocus)}>Focus</button>
        ) : null}
        {!compact ? (
          <>
            <div className="map-pin-field">
              <span>New pin</span>
              <PinTypePicker value={placeType} onChange={setPlaceType} />
            </div>
            <p className="muted world-map-hint">
              Drag to pan, scroll to zoom, click to place a pin, middle-click to delete. Resource markers stay visible through fog.
            </p>
          </>
        ) : (
          <p className="muted world-map-hint">Pan / zoom independent · shared UV</p>
        )}
      </div>
      <div
        ref={viewportRef}
        className="world-map-viewport"
        style={{ backgroundImage: `url(${sea})` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          setHovered(null)
          setCursorDebug(null)
        }}
        onAuxClick={(event) => {
          if (event.button !== 1) return
          event.preventDefault()
        }}
      >
        <div
          className="world-map-world"
          style={{
            width: imgSize.w,
            height: imgSize.h,
            transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`,
          }}
        >
          <img
            className="world-map-land"
            src={landmass}
            alt="Ashenfall"
            draggable={false}
            onLoad={(event) => {
              const img = event.currentTarget
              if (img.naturalWidth && img.naturalHeight) {
                setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
              }
            }}
          />
          <img
            className="world-map-underground"
            src={underground}
            alt=""
            draggable={false}
            style={{
              left: `${DEFAULT_UNDERGROUND_UV.u0 * 100}%`,
              top: `${DEFAULT_UNDERGROUND_UV.v0 * 100}%`,
              width: `${(DEFAULT_UNDERGROUND_UV.u1 - DEFAULT_UNDERGROUND_UV.u0) * 100}%`,
              height: `${(DEFAULT_UNDERGROUND_UV.v1 - DEFAULT_UNDERGROUND_UV.v0) * 100}%`,
            }}
          />
          <canvas ref={fogRef} className="world-map-fog" />
          {pins.map((pin, index) => {
            if (!enabledPinTypes.has(pin.PinType)) return null
            const loc = pin.PinLocation
            const { u, v } = worldToUv(loc[0], loc[1], mapBounds)
            const info = pinTypeInfo(pin.PinType)
            const icon = mapMarkerUrl(info.icon)
            const teardrop = 'teardrop' in info && info.teardrop
            return (
              <button
                key={`${index}-${loc[0]}-${loc[1]}`}
                type="button"
                data-pin={index}
                className={[
                  'world-map-pin',
                  teardrop ? 'teardrop' : '',
                  index === selectedIndex ? 'on' : '',
                ].filter(Boolean).join(' ')}
                style={{
                  left: `${u * 100}%`,
                  top: `${v * 100}%`,
                  transform: `${teardrop ? 'translate(-50%, -90%)' : 'translate(-50%, -50%)'} scale(${1 / cam.scale})`,
                }}
                title={`${info.label} (${Math.round(loc[0])}, ${Math.round(loc[1])})`}
              >
                {icon ? (
                  <img src={icon} alt="" draggable={false} />
                ) : (
                  <span className="world-map-pin-dot" />
                )}
              </button>
            )
          })}
        </div>
        <canvas ref={resourceRef} className="world-map-resources" />
        <canvas
          ref={debugRef}
          className="world-map-debug"
          style={{ display: showDebugOverlay ? 'block' : 'none' }}
        />
        {showDebugOverlay && cursorDebug ? (
          <div className="world-map-debug-hud">
            <div>land UV {cursorDebug.u.toFixed(4)}, {cursorDebug.v.toFixed(4)}</div>
            <div>world {Math.round(cursorDebug.x)}, {Math.round(cursorDebug.y)}</div>
            <div>MG CRS {cursorDebug.uCrs.toFixed(4)}, {cursorDebug.vCrs.toFixed(4)}</div>
            <div>lat/lng {cursorDebug.lat.toFixed(5)}, {cursorDebug.lng.toFixed(5)}</div>
          </div>
        ) : null}
        {hovered ? (
          <div
            className="world-map-tooltip"
            style={{ left: hovered.screenX + 12, top: hovered.screenY + 12 }}
          >
            <strong>{hovered.marker.title}</strong>
            {MAP_CALIBRATION_DEBUG ? (
              <>
                <span className="muted">
                  {hovered.marker.categoryId.replace(/-/g, ' ')} · {hovered.marker.source}
                </span>
                {typeof hovered.marker.lat === 'number' ? (
                  <span className="muted">
                    lat {hovered.marker.lat.toFixed(5)} · lng {hovered.marker.lng?.toFixed(5)}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function pinFromRow(row: JsonObject): Pin | null {
  const loc = Array.isArray(row.PinLocation) ? row.PinLocation : [0, 0]
  const x = typeof loc[0] === 'number' ? loc[0] : Number(loc[0])
  const y = typeof loc[1] === 'number' ? loc[1] : Number(loc[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return {
    PinType: typeof row.PinType === 'number' ? row.PinType : 1,
    PinLocation: [x, y],
  }
}
