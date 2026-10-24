// Turns the portrait luminance map into a grid of brightness values.

export const CELL_ASPECT = 1.75 // monospace cell height / width

export interface LumaGrid {
  cols: number
  rows: number
  data: Float32Array // 0..1 per cell, row-major
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Could not load ${src}`))
    img.src = src
  })
}

/** Try each source in order and resolve with the first that loads. */
export async function loadFirst(sources: string[]): Promise<HTMLImageElement> {
  let lastError: unknown
  for (const src of sources) {
    try {
      return await loadImage(src)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

/**
 * Sample the image into cols × rows cells. Rows are derived from the image
 * aspect and the monospace cell aspect so the portrait keeps its proportions.
 */
export function sampleGrid(img: HTMLImageElement, cols: number): LumaGrid {
  const aspect = img.naturalWidth / img.naturalHeight
  const rows = Math.max(1, Math.round(cols / (aspect * CELL_ASPECT)))

  // Step down in halves for a cleaner box-filtered result than one big resize.
  let src: CanvasImageSource = img
  let w = img.naturalWidth
  let h = img.naturalHeight
  while (w / 2 > cols * 2) {
    const c = document.createElement('canvas')
    c.width = Math.round(w / 2)
    c.height = Math.round(h / 2)
    const cx = c.getContext('2d')!
    cx.imageSmoothingQuality = 'high'
    cx.drawImage(src, 0, 0, c.width, c.height)
    src = c
    w = c.width
    h = c.height
  }

  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, cols, rows)
  const px = ctx.getImageData(0, 0, cols, rows).data

  const data = new Float32Array(cols * rows)
  for (let i = 0; i < data.length; i++) {
    const r = px[i * 4]
    const g = px[i * 4 + 1]
    const b = px[i * 4 + 2]
    // Perceptual luminance (Rec. 709 weights).
    let v = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    // Gentle S-curve: deepen shadows so eyes, brows and lips read clearly.
    v = Math.min(1, Math.max(0, (v - 0.5) * 1.18 + 0.5))
    v = Math.pow(v, 1.25)
    data[i] = v
  }
  return { cols, rows, data }
}
