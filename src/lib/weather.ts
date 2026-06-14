// ─────────────────────────────────────────────────────────────────────────
// Spray-window forecast via Open-Meteo (free, no API key, CORS-enabled so it
// can be fetched directly from the browser).
//
// Translates a daily forecast into a drone-spray go/no-go rating based on the
// constraints that matter for an Agras T50: wind & gusts (drift), rain
// (wash-off / can't fly), and temperature extremes.
// ─────────────────────────────────────────────────────────────────────────

import { BUSINESS } from '@/lib/business'

// HQ center for the forecast — from the configurable business profile.
export const CANBY_COORDS = { lat: BUSINESS.hqLat, lon: BUSINESS.hqLon }

export type SprayRating = 'GO' | 'CAUTION' | 'NO_GO'

export interface SprayDay {
  date: string // ISO (yyyy-mm-dd)
  label: string // e.g. 'Mon Jun 15'
  windMax: number // mph
  gustMax: number // mph
  precipProb: number // %
  tempMax: number // °F
  rating: SprayRating
  reasons: string[]
}

const RATING_ORDER: Record<SprayRating, number> = { GO: 0, CAUTION: 1, NO_GO: 2 }
const worse = (a: SprayRating, b: SprayRating): SprayRating =>
  RATING_ORDER[b] > RATING_ORDER[a] ? b : a

export async function fetchSprayWindows(
  lat = CANBY_COORDS.lat,
  lon = CANBY_COORDS.lon,
  days = 7
): Promise<SprayDay[]> {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(lat))
  url.searchParams.set('longitude', String(lon))
  url.searchParams.set(
    'daily',
    'precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,temperature_2m_max'
  )
  url.searchParams.set('timezone', 'America/Los_Angeles')
  url.searchParams.set('forecast_days', String(days))
  url.searchParams.set('wind_speed_unit', 'mph')
  url.searchParams.set('temperature_unit', 'fahrenheit')

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const data = await res.json()
  const d = data?.daily
  if (!d?.time) return []

  return d.time.map((date: string, i: number) =>
    scoreDay(
      date,
      d.wind_speed_10m_max?.[i] ?? 0,
      d.wind_gusts_10m_max?.[i] ?? 0,
      d.precipitation_probability_max?.[i] ?? 0,
      d.temperature_2m_max?.[i] ?? 60
    )
  )
}

function scoreDay(
  date: string,
  wind: number,
  gust: number,
  precip: number,
  temp: number
): SprayDay {
  const reasons: string[] = []
  let rating: SprayRating = 'GO'

  if (wind >= 15 || gust >= 20) {
    rating = 'NO_GO'
    reasons.push(`High wind ${Math.round(wind)} mph (gusts ${Math.round(gust)})`)
  } else if (wind >= 10 || gust >= 15) {
    rating = worse(rating, 'CAUTION')
    reasons.push(`Breezy ${Math.round(wind)} mph`)
  }

  if (precip >= 70) {
    rating = 'NO_GO'
    reasons.push(`Rain likely ${Math.round(precip)}%`)
  } else if (precip >= 40) {
    rating = worse(rating, 'CAUTION')
    reasons.push(`Rain risk ${Math.round(precip)}%`)
  }

  if (temp >= 90) {
    rating = worse(rating, 'CAUTION')
    reasons.push(`Hot ${Math.round(temp)}°F`)
  } else if (temp <= 40) {
    rating = worse(rating, 'CAUTION')
    reasons.push(`Cold ${Math.round(temp)}°F`)
  }

  if (reasons.length === 0) reasons.push('Calm & dry — ideal')

  return {
    date,
    label: new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }),
    windMax: Math.round(wind),
    gustMax: Math.round(gust),
    precipProb: Math.round(precip),
    tempMax: Math.round(temp),
    rating,
    reasons,
  }
}
