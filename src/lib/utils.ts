import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export type DateFormat = 'default' | 'dot' | 'short' | 'iso' | 'chinese'

const MONTH_NAMES_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
const MONTH_NAMES_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes))
}

export function parseDateInput(date: Date | string): Date {
  if (date instanceof Date) return date
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date "${date}"`)
  }
  return parsed
}

export function compareLocalizedText(a: string, b: string): number {
  return a.localeCompare(b, 'zh-CN', {
    numeric: true,
    sensitivity: 'base',
  })
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function getDateParts(date: Date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hours: date.getUTCHours(),
    minutes: date.getUTCMinutes(),
    seconds: date.getUTCSeconds(),
  }
}

export function formatDate(date: Date | string, format: DateFormat = 'default'): string {
  const d = parseDateInput(date)
  const { year, month, day, hours, minutes, seconds } = getDateParts(d)

  switch (format) {
    case 'dot':
      return `${year}.${pad(month)}.${pad(day)}`
    case 'short':
      return `${MONTH_NAMES_SHORT[month - 1]} ${day}, ${year}`
    case 'iso':
      return `${year}-${pad(month)}-${pad(day)} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    case 'chinese':
      return `${year}年${month}月${day}日`
    default:
      return `${MONTH_NAMES_LONG[month - 1]} ${day}, ${year}`
  }
}

/** 生成 UTC ISO 8601 字符串，用于 <time> 元素的 datetime 属性 */
export function toDateTimeISO(date: Date | string): string {
  const d = parseDateInput(date)
  const { year, month, day, hours, minutes, seconds } = getDateParts(d)
  return `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}Z`
}

export function isExternalLink(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

export function isIconClass(icon: string): boolean {
  return icon.startsWith('icon-[') || icon.startsWith('icon-')
}

export function encodeRoutePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
}
