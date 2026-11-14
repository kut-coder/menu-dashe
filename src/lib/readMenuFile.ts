const MAX_PDF_PAGES = 8

export interface MenuFileText {
  text: string
  note: string
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
  const Tesseract = await import('tesseract.js')
  const result = await Tesseract.recognize(file, 'rus+eng', {
    logger: (message) => {
      if (message.status === 'recognizing text' && typeof message.progress === 'number') {
        onProgress?.(Math.round(message.progress * 100))
      }
    },
  })
  return result.data.text
}

async function textFromDocx(data: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ arrayBuffer: data })
  return result.value.trim()
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

async function ocrPdfPage(
  page: {
    getViewport: (params: { scale: number }) => { width: number; height: number }
    render: (params: {
      canvas: HTMLCanvasElement
      viewport: { width: number; height: number }
    }) => { promise: Promise<unknown> }
  },
): Promise<string> {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2, 1400 / Math.max(base.width, 1))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, viewport }).promise
  const Tesseract = await import('tesseract.js')
  const result = await Tesseract.recognize(canvas, 'rus+eng')
  return result.data.text.trim()
}

async function textFromPdf(
  data: ArrayBuffer,
  onProgress?: (p: number) => void,
): Promise<MenuFileText> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
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
  return {
    text: parts.join('\n'),
    note: total > count ? `Прочитаны первые ${count} страниц из ${total}.` : '',
  }
}

export async function readMenuFile(
  file: File,
  onProgress?: (p: number) => void,
): Promise<MenuFileText> {
  const ext = extension(file.name)
  const type = file.type

  if (ext === '.doc' && type !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const data = await file.arrayBuffer()
    if (!isZip(data)) {
      throw new Error('Старый Word .doc не читается. Сохраните файл как .docx или PDF.')
    }
    onProgress?.(40)
    const text = await textFromDocx(data)
    if (!text) throw new Error('В документе Word не найден текст.')
    return { text, note: '' }
  }

  if (
    ext === '.docx' ||
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    onProgress?.(40)
    const text = await textFromDocx(await file.arrayBuffer())
    if (!text) throw new Error('В документе Word не найден текст.')
    return { text, note: '' }
  }

  if (ext === '.pdf' || type === 'application/pdf') {
    return textFromPdf(await file.arrayBuffer(), onProgress)
  }

  if (type.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) {
    const text = await textFromImage(file, onProgress)
    return { text, note: '' }
  }

  throw new Error('Нужен скрин, фото, PDF или Word .docx.')
}
