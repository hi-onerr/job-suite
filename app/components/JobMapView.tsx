'use client'

import { useState, useMemo } from 'react'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — react-simple-maps ships no type declarations
import {
  ComposableMap, Geographies, Geography, Marker, ZoomableGroup,
} from 'react-simple-maps'

// Natural Earth 110m topojson — served from CDN (no npm pkg needed)
const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

// ── City coordinate lookup ────────────────────────────────────────────────────
const CITY_COORDS: Record<string, [number, number]> = {
  // Indonesia
  'jakarta': [106.845, -6.211], 'south jakarta': [106.845, -6.261],
  'surabaya': [112.752, -7.257], 'bandung': [107.619, -6.917],
  'bali': [115.188, -8.409], 'yogyakarta': [110.364, -7.801],
  'semarang': [110.418, -6.966], 'medan': [98.674, 3.595],
  'depok': [106.832, -6.402], 'bekasi': [107.017, -6.241],
  'tangerang': [106.640, -6.178], 'indonesia': [117.0, -2.5],
  // Southeast Asia
  'singapore': [103.820, 1.352],
  'kuala lumpur': [101.686, 3.140], 'malaysia': [109.692, 2.0],
  'bangkok': [100.523, 13.736], 'thailand': [101.0, 15.0],
  'ho chi minh': [106.629, 10.823], 'hanoi': [105.854, 21.028], 'vietnam': [108.0, 14.0],
  'manila': [120.984, 14.600], 'philippines': [122.0, 12.0],
  // East Asia
  'tokyo': [139.692, 35.689], 'osaka': [135.502, 34.694], 'japan': [138.0, 36.5],
  'seoul': [126.978, 37.566], 'korea': [127.8, 35.9],
  'hong kong': [114.109, 22.397],
  'taipei': [121.565, 25.033], 'taiwan': [120.960, 23.7],
  'shanghai': [121.474, 31.230], 'beijing': [116.407, 39.904],
  'shenzhen': [114.057, 22.543], 'china': [104.0, 35.0],
  // South Asia
  'bangalore': [77.594, 12.972], 'mumbai': [72.877, 19.076],
  'delhi': [77.209, 28.614], 'hyderabad': [78.487, 17.385],
  'pune': [73.856, 18.520], 'chennai': [80.270, 13.083], 'india': [79.0, 22.0],
  // Oceania
  'sydney': [151.209, -33.868], 'melbourne': [144.963, -37.813],
  'perth': [115.861, -31.953], 'brisbane': [153.026, -27.470], 'australia': [134.0, -25.0],
  'auckland': [174.763, -36.848], 'new zealand': [171.5, -42.0],
  // Middle East
  'dubai': [55.296, 25.205], 'abu dhabi': [54.366, 24.453], 'uae': [54.0, 24.0],
  'riyadh': [46.675, 24.688], 'jeddah': [39.187, 21.543], 'saudi': [45.0, 25.0],
  'doha': [51.531, 25.286], 'qatar': [51.2, 25.3],
  'kuwait': [47.978, 29.370], 'muscat': [58.592, 23.614],
  'tel aviv': [34.781, 32.085], 'israel': [34.8, 31.0],
  'istanbul': [28.979, 41.015], 'turkey': [35.0, 39.0],
  'cairo': [31.235, 30.044], 'egypt': [30.0, 26.0],
  'beirut': [35.501, 33.889], 'amman': [35.945, 31.956],
  // Europe
  'london': [-0.128, 51.507], 'manchester': [-2.243, 53.480], 'uk': [-3.0, 55.0],
  'paris': [2.349, 48.864], 'france': [2.5, 46.5],
  'berlin': [13.404, 52.520], 'munich': [11.582, 48.135],
  'frankfurt': [8.682, 50.110], 'germany': [10.5, 51.5],
  'amsterdam': [4.899, 52.379], 'netherlands': [5.3, 52.1],
  'zurich': [8.541, 47.376], 'switzerland': [8.0, 47.0],
  'stockholm': [18.068, 59.333], 'sweden': [18.0, 62.0],
  'oslo': [10.739, 59.913], 'norway': [10.0, 64.0],
  'copenhagen': [12.568, 55.676], 'denmark': [10.0, 56.0],
  'helsinki': [24.941, 60.170], 'finland': [26.0, 62.0],
  'warsaw': [21.017, 52.237], 'poland': [20.0, 52.0],
  'prague': [14.421, 50.088], 'brussels': [4.351, 50.846],
  'vienna': [16.373, 48.208], 'madrid': [-3.703, 40.417],
  'barcelona': [2.154, 41.388], 'rome': [12.496, 41.903],
  'milan': [9.190, 45.465], 'lisbon': [-9.139, 38.722],
  'athens': [23.729, 37.983], 'dublin': [-6.259, 53.350],
  'europe': [15.0, 51.0],
  // Americas
  'new york': [-74.006, 40.713], 'san francisco': [-122.419, 37.775],
  'los angeles': [-118.243, 34.052], 'chicago': [-87.629, 41.878],
  'seattle': [-122.332, 47.606], 'boston': [-71.059, 42.361],
  'austin': [-97.743, 30.267], 'denver': [-104.990, 39.739],
  'miami': [-80.191, 25.774], 'dallas': [-96.797, 32.777],
  'houston': [-95.369, 29.760], 'washington': [-77.037, 38.907],
  'toronto': [-79.383, 43.653], 'vancouver': [-123.120, 49.282],
  'montreal': [-73.567, 45.501], 'canada': [-96.0, 56.0],
  'sao paulo': [-46.633, -23.550], 'brazil': [-53.0, -14.0],
  'mexico city': [-99.133, 19.433], 'buenos aires': [-58.381, -34.603],
  'usa': [-98.0, 38.0], 'united states': [-98.0, 38.0],
  // Africa
  'lagos': [3.379, 6.455], 'nigeria': [8.0, 10.0],
  'nairobi': [36.817, -1.292], 'kenya': [37.9, 0.0],
  'johannesburg': [28.045, -26.204], 'cape town': [18.424, -33.925],
  'south africa': [25.0, -29.0], 'accra': [-0.187, 5.603],
  'casablanca': [-7.589, 33.574], 'cairo egypt': [31.235, 30.044],
}

function geocode(location: string): [number, number] | null {
  if (!location || location === 'Unknown') return null
  const l = location.toLowerCase()
  // Try progressively shorter substrings of the location
  for (const key of Object.keys(CITY_COORDS)) {
    if (l.includes(key)) return CITY_COORDS[key]
  }
  return null
}

const STATUS_COLOR: Record<string, string> = {
  saved: '#6366f1', applied: '#3b82f6', interview: '#f59e0b',
  offer: '#10b981', rejected: '#ef4444',
}

interface Props {
  jobs: {
    id: string; company: string; role: string; location: string
    status: string; matchScore?: number; url?: string
  }[]
  onOpen: (id: string) => void
}

export default function JobMapView({ jobs, onOpen }: Props) {
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState<[number, number]>([20, 10])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)

  // Group jobs by coordinate (stack pins at same location)
  const pins = useMemo(() => {
    const map = new Map<string, typeof jobs>()
    for (const j of jobs) {
      const coords = geocode(j.location)
      if (!coords) continue
      // Round to 1dp for grouping nearby cities
      const key = `${coords[0].toFixed(1)},${coords[1].toFixed(1)}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(j)
    }
    return Array.from(map.entries()).map(([key, group]) => {
      const [lng, lat] = key.split(',').map(Number)
      return { lng, lat, jobs: group }
    })
  }, [jobs])

  const unmapped = jobs.filter(j => !geocode(j.location))

  return (
    <div className="space-y-3">
      <div className="card p-0 overflow-hidden bg-[#0f172a] relative" style={{ height: 480 }}>
        {/* Zoom controls */}
        <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
          <button onClick={() => setZoom(z => Math.min(z * 1.5, 8))}
            className="w-7 h-7 bg-white/10 hover:bg-white/20 text-white rounded flex items-center justify-center text-lg font-bold transition-colors">+</button>
          <button onClick={() => setZoom(z => Math.max(z / 1.5, 1))}
            className="w-7 h-7 bg-white/10 hover:bg-white/20 text-white rounded flex items-center justify-center text-lg font-bold transition-colors">−</button>
          <button onClick={() => { setZoom(1); setCenter([20, 10]) }}
            className="w-7 h-7 bg-white/10 hover:bg-white/20 text-white rounded flex items-center justify-center text-[10px] transition-colors">⊙</button>
        </div>

        {/* Legend */}
        <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-x-3 gap-y-1">
          {Object.entries(STATUS_COLOR).map(([s, c]) => (
            <span key={s} className="flex items-center gap-1 text-[10px] text-white/70">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: c }} />
              {s}
            </span>
          ))}
        </div>

        {/* Custom tooltip */}
        {tooltip && (
          <div className="absolute z-20 pointer-events-none bg-slate-800 text-white text-[11px] rounded-lg px-2.5 py-1.5 shadow-lg max-w-[220px] leading-relaxed whitespace-pre-line"
            style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}>
            {tooltip.text}
          </div>
        )}

        <ComposableMap
          className="map-container"
          projection="geoMercator"
          projectionConfig={{ scale: 140, center: [20, 10] }}
          style={{ width: '100%', height: '100%', background: '#0f172a' }}
        >
          <ZoomableGroup
            zoom={zoom}
            center={center}
            onMoveEnd={({ zoom: z, coordinates }: { zoom: number; coordinates: [number, number] }) => {
              setZoom(z)
              setCenter(coordinates)
            }}
          >
            <Geographies geography={GEO_URL}>
              {({ geographies }: { geographies: any[] }) =>
                geographies.map((geo: any) => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    style={{
                      default: { fill: '#1e3a5f', stroke: '#0f172a', strokeWidth: 0.5, outline: 'none' },
                      hover:   { fill: '#234d78', stroke: '#0f172a', strokeWidth: 0.5, outline: 'none' },
                      pressed: { fill: '#234d78', outline: 'none' },
                    }}
                  />
                ))
              }
            </Geographies>

            {pins.map(({ lng, lat, jobs: group }) => {
              const dominant = group.reduce((best, j) =>
                (j.matchScore || 0) > (best.matchScore || 0) ? j : best, group[0])
              const r = Math.min(5 + group.length * 2, 14)
              const isHovered = group.some(j => j.id === hoveredId)

              return (
                <Marker key={`${lng},${lat}`} coordinates={[lng, lat]}>
                  <circle
                    r={isHovered ? r + 2 : r}
                    fill={STATUS_COLOR[dominant.status] || '#6366f1'}
                    fillOpacity={isHovered ? 1 : 0.85}
                    stroke="#fff"
                    strokeWidth={isHovered ? 2 : 1}
                    style={{ cursor: 'pointer', transition: 'all 0.15s' }}
                    onMouseEnter={(e) => {
                      setHoveredId(dominant.id)
                      const rect = (e.target as SVGElement).closest('svg')?.getBoundingClientRect()
                      const mapRect = (e.target as SVGElement).closest('.map-container')?.getBoundingClientRect()
                      const base = mapRect || rect
                      if (base) setTooltip({
                        x: e.clientX - base.left,
                        y: e.clientY - base.top,
                        text: group.map(j => `${j.role}\n${j.company}`).join('\n─────\n'),
                      })
                    }}
                    onMouseLeave={() => { setHoveredId(null); setTooltip(null) }}
                    onClick={() => group.length === 1 ? onOpen(group[0].id) : null}
                  />
                  {group.length > 1 && (
                    <text
                      textAnchor="middle"
                      dy="0.35em"
                      fontSize={r < 10 ? 7 : 9}
                      fontWeight="bold"
                      fill="white"
                      style={{ pointerEvents: 'none' }}
                    >
                      {group.length}
                    </text>
                  )}
                </Marker>
              )
            })}
          </ZoomableGroup>
        </ComposableMap>

      </div>

      {/* Job list below map — filtered to those with coords or without */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {pins.flatMap(p => p.jobs).map(j => (
          <button
            key={j.id}
            onClick={() => onOpen(j.id)}
            className="text-left card py-2.5 px-3 border hover:border-primary/40 hover:bg-blue-50/30 transition-all"
          >
            <div className="flex items-start justify-between gap-1 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={{ background: STATUS_COLOR[j.status] + '22', color: STATUS_COLOR[j.status] }}>
                {j.status}
              </span>
              {j.matchScore ? <span className="text-[10px] text-gray-400">{j.matchScore}%</span> : null}
            </div>
            <p className="text-xs font-semibold text-gray-800 leading-tight truncate">{j.role}</p>
            <p className="text-[10px] text-gray-500 truncate">{j.company}</p>
            <p className="text-[10px] text-gray-400 flex items-center gap-0.5 mt-0.5 truncate">
              📍 {j.location || '—'}
            </p>
          </button>
        ))}
      </div>

      {unmapped.length > 0 && (
        <div className="card border-dashed border-gray-200 py-2 px-3">
          <p className="text-[10px] text-gray-400 mb-1.5">📌 Tidak terpetakan ({unmapped.length} loker — lokasi tidak dikenali):</p>
          <div className="flex flex-wrap gap-1.5">
            {unmapped.map(j => (
              <button key={j.id} onClick={() => onOpen(j.id)}
                className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded transition-colors">
                {j.role} @ {j.company}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
