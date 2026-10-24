import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { AsciiEngine, CharMode, EngineStatus } from '../engine/AsciiEngine'
import { loadFirst } from '../engine/sampler'

export interface PortraitHandle {
  replay(): void
  scatter(): void
  exportPNG(): Promise<Blob | null>
}

interface Props {
  cols: number
  motion: number
  mode: CharMode
  onStatus(s: EngineStatus): void
  onError(message: string): void
}

const BASE = import.meta.env.BASE_URL
// Preprocessed luminance map (see scripts/preprocess.py).
const SOURCES = [`${BASE}portrait-map.png`]
const MONO = '"DM Mono"'

export const PortraitCanvas = forwardRef<PortraitHandle, Props>(function PortraitCanvas(
  { cols, motion, mode, onStatus, onError },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<AsciiEngine | null>(null)
  const statusRef = useRef(onStatus)
  statusRef.current = onStatus
  const errorRef = useRef(onError)
  errorRef.current = onError
  const initial = useRef({ cols, motion, mode })

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    let cancelled = false
    const engine = new AsciiEngine(host, canvas, {
      ...initial.current,
      onStatus: (s) => statusRef.current(s),
    })
    engineRef.current = engine

    // Wait for the mono font so the glyph atlas is drawn with it.
    const fontReady = document.fonts
      ? document.fonts.load(`400 16px ${MONO}`).catch(() => undefined)
      : Promise.resolve()
    Promise.all([loadFirst(SOURCES), fontReady])
      .then(([img]) => {
        if (!cancelled) engine.setImage(img)
      })
      .catch(() => {
        if (cancelled) return
        engine.setError()
        errorRef.current('The portrait image could not be loaded.')
      })

    return () => {
      cancelled = true
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  useEffect(() => engineRef.current?.setCols(cols), [cols])
  useEffect(() => engineRef.current?.setMotion(motion), [motion])
  useEffect(() => engineRef.current?.setMode(mode), [mode])

  useImperativeHandle(ref, () => ({
    replay: () => engineRef.current?.replay(),
    scatter: () => engineRef.current?.scatter(),
    exportPNG: () => engineRef.current?.exportPNG() ?? Promise.resolve(null),
  }))

  return (
    <div ref={hostRef} className="canvas-host">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="An animated portrait of Aayushi drawn entirely with text characters"
      />
    </div>
  )
})
