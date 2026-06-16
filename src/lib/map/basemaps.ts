// Shared Leaflet basemap definitions (free tiles — no API token required).
// Used by the generalized LeadMap; the EFB RiskMap keeps its own inline copy.

export type Basemap = 'satellite' | 'streets' | 'terrain'

export const BASEMAPS: Record<Basemap, { url: string; attribution: string; maxZoom: number }> = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri — Maxar, Earthstar Geographics, GIS Community',
    maxZoom: 19,
  },
  streets: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 20,
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map data: &copy; OpenStreetMap, SRTM | &copy; OpenTopoMap',
    maxZoom: 17,
  },
}

export const BASEMAP_OPTIONS: { key: Basemap; label: string }[] = [
  { key: 'satellite', label: 'Satellite' },
  { key: 'streets', label: 'Streets' },
  { key: 'terrain', label: 'Terrain' },
]
