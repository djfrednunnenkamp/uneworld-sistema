import { useEffect, useRef } from 'react'
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

export default function LocationMap({ lat, lng, label, height = 200 }) {
  const ref = useRef(null)
  const mapRef = useRef(null)

  useEffect(() => {
    if (!ref.current || lat == null || lng == null) return
    const map = L.map(ref.current, { attributionControl: false, zoomControl: false }).setView([lat, lng], 11)
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map)
    L.marker([lat, lng], { icon: markerIcon }).addTo(map).bindPopup(label || '').openPopup()
    return () => { map.remove(); mapRef.current = null }
  }, [lat, lng, label])

  if (lat == null || lng == null) return null

  return <div ref={ref} style={{ height, borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0' }} />
}
