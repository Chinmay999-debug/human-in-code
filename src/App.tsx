import { CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { Controls, DETAIL_LEVELS } from './components/Controls'
import { PortraitCanvas, PortraitHandle } from './components/PortraitCanvas'
import { CharMode, EngineStatus, RAMPS } from './engine/AsciiEngine'

const narrow = () => window.matchMedia('(max-width: 640px)').matches
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function phaseLabel(s: EngineStatus | null, error: string | null) {
  if (error) return 'SOURCE UNAVAILABLE'
  if (!s || s.phase === 'loading') return 'LOADING SOURCE'
  switch (s.phase) {
    case 'field':
      return 'CHARACTER FIELD'
    case 'assembling':
      return `ASSEMBLING ${String(Math.round(s.progress * 100)).padStart(3, '0')}%`
    case 'scattering':
      return 'DISPERSING'
    case 'formed':
      return 'PORTRAIT FORMED'
    default:
      return ''
  }
}

export default function App() {
  const portrait = useRef<PortraitHandle>(null)
  const [maxDetail, setMaxDetail] = useState(() => (narrow() ? 3 : DETAIL_LEVELS.length - 1))
  const [detail, setDetail] = useState(() => (narrow() ? 2 : 3))
  const [motion, setMotion] = useState(() => (reduced() ? 0 : 0.35))
  const [mode, setMode] = useState<CharMode>('classic')
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const dedicationRef = useRef<HTMLElement>(null)
  const [dedicationSeen, setDedicationSeen] = useState(false)

  useEffect(() => {
    const el = dedicationRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setDedicationSeen(true)
          io.disconnect()
        }
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const onChange = () => {
      const max = mq.matches ? 3 : DETAIL_LEVELS.length - 1
      setMaxDetail(max)
      setDetail((d) => Math.min(d, max))
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const replay = useCallback(() => portrait.current?.replay(), [])
  const scatter = useCallback(() => portrait.current?.scatter(), [])

  const exportPNG = useCallback(async () => {
    if (!portrait.current) return
    setExporting(true)
    try {
      const blob = await portrait.current.exportPNG()
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `for-ayushi-${mode}-${DETAIL_LEVELS[detail]}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally {
      setExporting(false)
    }
  }, [mode, detail])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'TEXTAREA' || (tag === 'INPUT' && (e.target as HTMLInputElement).type === 'text')) return
      if (e.key === 'r' || e.key === 'R') replay()
      else if (e.key === 's' || e.key === 'S') scatter()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [replay, scatter])

  const formed = status?.phase === 'formed'
  const glyphs = status?.glyphs ?? 0

  return (
    <div className="page">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="For Ayushi, back to top">
          FOR <span className="brand-slash">/</span> AYUSHI
        </a>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <span>001</span>
              <span className="rule" aria-hidden />
              <span>Made for Ayushi</span>
            </p>
            <h1>
              Ayushi, <em>in code.</em>
            </h1>
            <p className="lede">Her face, rebuilt from thousands of characters — one for every bit of light.</p>
          </div>
          <dl className="hero-meta">
            <div>
              <dt>Dedicated to</dt>
              <dd>Ayushi</dd>
            </div>
            <div>
              <dt>Medium</dt>
              <dd>Monospace glyphs</dd>
            </div>
            <div>
              <dt>Glyphs</dt>
              <dd className="tabular">{glyphs ? glyphs.toLocaleString('en-US') : '—'}</dd>
            </div>
            <div>
              <dt>Ramp</dt>
              <dd className="mono ramp">{RAMPS[mode].trim()}</dd>
            </div>
          </dl>
        </section>

        <section className="stage" aria-label="Live portrait of Ayushi">
          <div className={`frame${formed ? ' is-formed' : ''}`}>
            <PortraitCanvas
              ref={portrait}
              cols={DETAIL_LEVELS[detail]}
              motion={motion}
              mode={mode}
              onStatus={setStatus}
              onError={setError}
            />
            <span className="tick tl" aria-hidden />
            <span className="tick tr" aria-hidden />
            <span className="tick bl" aria-hidden />
            <span className="tick br" aria-hidden />
            <div className="label label-tl">
              <span className="dot live" aria-hidden />
              LIVE CANVAS
            </div>
            <div className="label label-tr">PORTRAIT OF AYUSHI</div>
            <div className="label label-bl tabular">
              {status && status.cols ? `${status.cols} × ${status.rows} GRID` : '— × — GRID'}
            </div>
            <div className="label label-br tabular" aria-live="polite">
              {phaseLabel(status, error)}
            </div>
            {error && (
              <div className="frame-error" role="alert">
                <p>{error}</p>
                <p className="mono">Expected public/portrait-map.png</p>
              </div>
            )}
          </div>

          <Controls
            detail={detail}
            maxDetail={maxDetail}
            motion={motion}
            mode={mode}
            busy={!status || status.phase === 'loading' || !!error}
            exporting={exporting}
            onDetail={setDetail}
            onMotion={setMotion}
            onMode={setMode}
            onReplay={replay}
            onScatter={scatter}
            onExport={exportPNG}
          />
          <p className="hint">Hover the portrait to disturb it. Keys: R replay · S scatter.</p>
        </section>

        <section className="closing">
          <div className="closing-head">
            <p className="eyebrow">
              <span>002</span>
              <span className="rule" aria-hidden />
              <span>How it was made</span>
            </p>
            <h2>Pixels become personality.</h2>
            <p className="closing-lede">
              A single photograph of Ayushi, never shown directly. It is sampled into a grid, each cell is measured
              for how much light it holds, and that number chooses a character — sparse marks for shadow, dense ones
              for light. Thousands of them drift in from the dark and find their way to her.
            </p>
          </div>
          <ol className="steps">
            <li>
              <span className="step-n">01</span>
              <h3>Sample</h3>
              <p>The image is reduced to a grid of cells, taller than they are wide to match a monospace glyph.</p>
            </li>
            <li>
              <span className="step-n">02</span>
              <h3>Measure</h3>
              <p>
                Each cell becomes one number: perceptual luminance, <span className="mono">0.21R + 0.72G + 0.07B</span>,
                with a gentle curve to keep the eyes and lips legible.
              </p>
            </li>
            <li>
              <span className="step-n">03</span>
              <h3>Map</h3>
              <p>
                Brightness picks a glyph from a density ramp. Every character is drawn on canvas, then flown from a
                random start to its seat.
              </p>
            </li>
          </ol>
          <div className="ramp-strip mono" aria-label="Character density ramp">
            {[...RAMPS.classic].map((c, i) => (
              <span key={i} style={{ opacity: 0.25 + (i / (RAMPS.classic.length - 1)) * 0.75 }}>
                {c === ' ' ? '·' : c}
              </span>
            ))}
          </div>
        </section>

        <section ref={dedicationRef} className={`dedication${dedicationSeen ? ' is-visible' : ''}`} aria-label="Dedication">
          <p className="eyebrow">
            <span>003</span>
            <span className="rule" aria-hidden />
            <span>Dedication</span>
          </p>
          <p className="dedication-word mono" aria-hidden>
            {'AYUSHI'.split('').map((c, i) => (
              <span key={i} style={{ '--i': i } as CSSProperties}>
                {c}
              </span>
            ))}
          </p>
          <h2>
            For Ayushi, <em>with love.</em>
          </h2>
          <p className="closing-lede">
            Every glyph on this page was placed for you. Press replay whenever you like — they will always find
            their way back to your face.
          </p>
        </section>
      </main>

      <footer className="site-footer">
        <span>Made for Ayushi</span>
        <span className="mono">{'<canvas> · thousands of characters · one face'}</span>
        <a href="#top">Back to top ↑</a>
      </footer>
    </div>
  )
}
