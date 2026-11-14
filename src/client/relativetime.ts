/**
 * "刚刚 / 5 分钟前 / 2 小时前 / 3 天前" for history rows and tree details.
 *
 * Floor per unit (never rounds a 23h40m age up to "24 小时前"), so the two
 * surfaces that show an age cannot drift apart again.
 */
import { t } from './i18n'

export function agoText(seconds: number): string {
  if (!Number.isFinite(seconds)) return t('relative.justNow')
  const whole = Math.max(0, Math.round(seconds))
  if (whole < 60) return t('relative.justNow')
  const minutes = Math.floor(whole / 60)
  if (minutes < 60) return t('relative.minutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('relative.hoursAgo', { n: hours })
  return t('relative.daysAgo', { n: Math.floor(hours / 24) })
}

/** Cached-structure age shown under a data source; '' when the stamp is unusable. */
export function relativeTime(iso: string): string {
  const stamp = Date.parse(iso)
  if (Number.isNaN(stamp)) return ''
  return agoText((Date.now() - stamp) / 1000)
}
