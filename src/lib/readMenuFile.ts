import JSZip from 'jszip'
import type { PDFPageProxy } from 'pdfjs-dist'
import { loadFreshChunk } from './appUpdate'

const MAX_PDF_PAGES = 8

export type MenuPart =
  | { kind: 'text'; text: string }
  | { kind: 'table'; rows: string[][] }

export interface MenuFileText {
  text: string
  note: string
  parts: MenuPart[]
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function isZip(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data.slice(0, 4))
  return bytes[0] === 0x50 && bytes[1] === 0x4b
}

async function textFromImage(
  file: File,
  onProgress?: (p: number) => void,
): Promise<string> {
  const Tesseract = await loadFreshChunk(() => import('tesseract.js'))
  const result = await Tesseract.recognize(file, 'rus+eng', {
    logger: (message) => {
      if (message.status === 'recognizing text' && typeof message.progress === 'number') {
        onProgress?.(Math.round(message.progress * 100))
      }
    },
  })
  return result.data.text
}

function asTextPart(text: string): MenuPart[] {
  const trimmed = text.trim()
  return trimmed ? [{ kind: 'text', text: trimmed }] : []
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function paragraphTexts(fragment: string): string[] {
  return fragment
    .split(/<w:p(?:\s[^>]*)?>/)
    .slice(1)
    .map((chunk) => {
      const body = chunk.split('</w:p>')[0] ?? chunk
      return [...body.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
        .map((match) => decodeXml(match[1]))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    })
    .filter(Boolean)
}

/** Таблицу Word сохраняем по ячейкам, чтобы дни в шапке не склеивались в один день. */
export function partsFromDocumentXml(xml: string): MenuPart[] {
  const parts: MenuPart[] = []
  const chunks = xml.split(/<w:tbl(?:\s[^>]*)?>/)
  const before = paragraphTexts(chunks[0] ?? '')
  if (before.length) parts.push({ kind: 'text', text: before.join('\n') })
  for (const chunk of chunks.slice(1)) {
    const end = chunk.indexOf('</w:tbl>')
    const tableXml = end >= 0 ? chunk.slice(0, end) : chunk
    const after = end >= 0 ? chunk.slice(end + '</w:tbl>'.length) : ''
    const rows = tableXml
      .split(/<w:tr(?:\s[^>]*)?>/)
      .slice(1)
      .map((rowXml) => {
        const rowBody = rowXml.split('</w:tr>')[0] ?? rowXml
        return rowBody.split(/<w:tc(?:\s[^>]*)?>/).slice(1).map((cellXml) => {
          const cellBody = cellXml.split('</w:tc>')[0] ?? cellXml
          return paragraphTexts(cellBody).join('\n')
        })
      })
      .filter((row) => row.length > 0)
    if (rows.length) parts.push({ kind: 'table', rows })
    const tail = paragraphTexts(after)
    if (tail.length) parts.push({ kind: 'text', text: tail.join('\n') })
  }
  return parts
}

async function textFromDocx(data: ArrayBuffer): Promise<MenuPart[]> {
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new Error('Файл Word повреждён или это старый формат .doc. Сохраните его как .docx.')
  }
  const entry = zip.file('word/document.xml')
  if (!entry) {
    throw new Error('В файле Word нет текста. Сохраните документ как .docx.')
  }
  return partsFromDocumentXml(await entry.async('string'))
}

function linesFromPdfItems(items: unknown[]): string {
  const rows: { x: number; y: number; str: string }[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object' || !('str' in item)) continue
    const text = item as { str?: string; transform?: number[] }
    const str = text.str?.trim()
    if (!str) continue
    rows.push({
      x: Number(text.transform?.[4] ?? 0),
      y: Number(text.transform?.[5] ?? 0),
      str,
    })
  }
  rows.sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: { y: number; parts: { x: number; str: string }[] }[] = []
  for (const row of rows) {
    const last = lines.at(-1)
    if (last && Math.abs(last.y - row.y) < 3) last.parts.push(row)
    else lines.push({ y: row.y, parts: [row] })
  }
  return lines
    .map((line) =>
      line.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n')
}

async function ocrPdfPage(page: PDFPageProxy): Promise<string> {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2, 1400 / Math.max(base.width, 1))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, viewport }).promise
  const Tesseract = await loadFreshChunk(() => import('tesseract.js'))
  const result = await Tesseract.recognize(canvas, 'rus+eng')
  return result.data.text.trim()
}

async function textFromPdf(
  data: ArrayBuffer,
  onProgress?: (p: number) => void,
): Promise<MenuFileText> {
  const pdfjs = await loadFreshChunk(() => import('pdfjs-dist'))
  const worker = await loadFreshChunk(() => import('pdfjs-dist/build/pdf.worker.min.mjs?url'))
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const pdf = await pdfjs
    .getDocument({ data: new Uint8Array(data), verbosity: 0 })
    .promise
  const total = pdf.numPages
  const count = Math.min(total, MAX_PDF_PAGES)
  const parts: string[] = []
  for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
    onProgress?.(Math.round(((pageNumber - 1) / count) * 100))
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    let text = linesFromPdfItems(content.items)
    if (text.replace(/\s/g, '').length < 20) {
      text = await ocrPdfPage(page)
    }
    if (text) parts.push(text)
    page.cleanup()
  }
  const text = parts.join('\n')
  return {
    text,
    note: total > count ? `Прочитаны первые ${count} страниц из ${total}.` : '',
    parts: asTextPart(text),
  }
}

function looksLikeDocx(name: string, type: string): boolean {
  const ext = extension(name)
  return (
    ext === '.docx' ||
    ext === '.doc' ||
    type.includes('wordprocessingml') ||
    type === 'application/msword'
  )
}

export async function readMenuFile(
  file: File,
  onProgress?: (p: number) => void,
): Promise<MenuFileText> {
  const ext = extension(file.name)
  const type = file.type
  const data = await file.arrayBuffer()

  if (ext === '.pdf' || type === 'application/pdf' || isPdf(data)) {
    return textFromPdf(data, onProgress)
  }

  if (looksLikeDocx(file.name, type) || isZip(data)) {
    if ((ext === '.doc' || type === 'application/msword') && !isZip(data)) {
      throw new Error('Старый Word .doc не читается. Сохраните файл как .docx или PDF.')
    }
    onProgress?.(40)
    const parts = await textFromDocx(data)
    const text = parts
      .flatMap((part) => (part.kind === 'text' ? [part.text] : part.rows.flat()))
      .join('\n')
      .trim()
    if (!text) throw new Error('В документе Word не найден текст.')
    return { text, note: '', parts }
  }

  if (type.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) {
    const text = await textFromImage(file, onProgress)
    return { text, note: '', parts: asTextPart(text) }
  }

  throw new Error('Нужен скрин, фото, PDF или Word .docx.')
}

function isPdf(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data.slice(0, 4))
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}
