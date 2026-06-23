import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Ícone padrão do Leaflet depende de imagens que o bundler não resolve
// automaticamente — aponta direto pro CDN do unpkg (mesma versão do pacote).
const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
})

const STORAGE_KEY = 'uneworld_map_style'

// Estilos de mapa disponíveis — escolha vira padrão pro resto do sistema
// (qualquer outro lugar que use <LocationMap> respeita a mesma preferência).
const MAP_STYLES = {
  claro: {
    label: 'Claro',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd', maxZoom: 19,
  },
  colorido: {
    label: 'Colorido',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd', maxZoom: 19,
  },
  satelite: {
    label: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
    maxZoom: 19,
  },
}

export function getDefaultMapStyle() {
  return localStorage.getItem(STORAGE_KEY) || 'claro'
}

export default function LocationMap({ lat, lng, height = 200 }) {
  const ref = useRef(null)
  const mapRef = useRef(null)
  const tileRef = useRef(null)
  const [mapStyle, setMapStyle] = useState(getDefaultMapStyle)

  useEffect(() => {
    if (!ref.current || lat == null || lng == null) return
    const map = L.map(ref.current, { attributionControl: false, zoomControl: false }).setView([lat, lng], 13)
    mapRef.current = map
    L.marker([lat, lng], { icon: markerIcon }).addTo(map)
    return () => { map.remove(); mapRef.current = null; tileRef.current = null }
  }, [lat, lng])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (tileRef.current) map.removeLayer(tileRef.current)
    const cfg = MAP_STYLES[mapStyle] || MAP_STYLES.claro
    const tileOpts = { maxZoom: cfg.maxZoom }
    if (cfg.subdomains) tileOpts.subdomains = cfg.subdomains
    tileRef.current = L.tileLayer(cfg.url, tileOpts)
    tileRef.current.addTo(map)
  }, [mapStyle, lat, lng])

  const chooseStyle = (key) => {
    setMapStyle(key)
    localStorage.setItem(STORAGE_KEY, key)
  }

  if (lat == null || lng == null) return null

  return (
    <div style={{ position: 'relative' }}>
      <div ref={ref} style={{ height, borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0' }} />
      <div style={{
        position: 'absolute', top: 8, right: 8, zIndex: 400, display: 'flex', gap: 3,
        background: 'rgba(255,255,255,.95)', borderRadius: 7, padding: 3, boxShadow: '0 1px 4px rgba(0,0,0,.15)',
      }}>
        {Object.entries(MAP_STYLES).map(([key, cfg]) => (
          <button key={key} type="button" onClick={() => chooseStyle(key)}
            title={cfg.label}
            style={{
              padding: '4px 9px', borderRadius: 5, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
              background: mapStyle === key ? '#2e6db4' : 'transparent',
              color: mapStyle === key ? '#fff' : '#475569',
              transition: 'all .12s',
            }}>
            {cfg.label}
          </button>
        ))}
      </div>
    </div>
  )
}
