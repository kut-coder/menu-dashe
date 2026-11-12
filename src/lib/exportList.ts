import { formatDayShort, formatWeekRange } from './dates'
import { formatAmount, sortByStore } from './shopping'
import { STORE_LABELS, type ShoppingList } from '../types'

const TG_KEY = (userId: string) => `menu-app:telegram:${userId}`

export function getSavedTelegram(userId: string): string {
  return localStorage.getItem(TG_KEY(userId)) ?? ''
}

export function saveTelegramContact(userId: string, raw: string) {
  const cleaned = raw.trim().replace(/^@/, '')
  if (cleaned) localStorage.setItem(TG_KEY(userId), cleaned)
  else localStorage.removeItem(TG_KEY(userId))
  return cleaned
}

export function formatShoppingListText(
  list: ShoppingList,
  weekStart: string,
  byStore: boolean,
): string {
  const items = byStore ? sortByStore(list.items) : [...list.items]
  const days = list.selectedDates.map((d) => formatDayShort(d)).join(', ')
  const lines: string[] = [
    'Список покупок',
    `Неделя: ${formatWeekRange(weekStart)}`,
    `Дни: ${days}`,
    '',
  ]

  let lastStore = ''
  for (const item of items) {
    if (byStore) {
      const storeLabel = item.store ? STORE_LABELS[item.store] : 'Без магазина'
      if (storeLabel !== lastStore) {
        lines.push(`— ${storeLabel} —`)
        lastStore = storeLabel
      }
    }
    const mark = item.bought ? '✓' : '○'
    lines.push(
      `${mark} ${item.name} — ${formatAmount(item.amount, item.unit)}`,
    )
  }

  return lines.join('\n')
}

/** Открывает окно печати — в диалоге можно «Сохранить как PDF». */
export function saveListAsPdf(
  list: ShoppingList,
  weekStart: string,
  byStore: boolean,
) {
  const text = formatShoppingListText(list, weekStart, byStore)
  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Список покупок</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; color: #111; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    pre { white-space: pre-wrap; font-size: 14px; line-height: 1.45; }
  </style>
</head>
<body>
  <h1>Список покупок</h1>
  <pre>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>
  <script>window.onload = () => { window.print(); }</script>
</body>
</html>`
  const win = window.open('', '_blank', 'noopener,noreferrer,width=720,height=900')
  if (!win) {
    throw new Error('Разрешите всплывающие окна для сохранения PDF')
  }
  win.document.write(html)
  win.document.close()
}

export function sendListToTelegram(text: string, username?: string) {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent('')}&text=${encodeURIComponent(text)}`
  window.open(shareUrl, '_blank', 'noopener,noreferrer')
  if (username) {
    window.setTimeout(() => {
      window.open(`https://t.me/${username}`, '_blank', 'noopener,noreferrer')
    }, 400)
  }
}
