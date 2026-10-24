import { CharMode } from '../engine/AsciiEngine'

export const DETAIL_LEVELS = [64, 88, 112, 140, 168]

interface Props {
  detail: number
  maxDetail: number
  motion: number
  mode: CharMode
  busy: boolean
  exporting: boolean
  onDetail(v: number): void
  onMotion(v: number): void
  onMode(m: CharMode): void
  onReplay(): void
  onScatter(): void
  onExport(): void
}

const MODES: { id: CharMode; label: string; sample: string }[] = [
  { id: 'classic', label: 'Classic', sample: '@#A:' },
  { id: 'numbers', label: 'Numbers', sample: '8041' },
  { id: 'symbols', label: 'Symbols', sample: '&%+~' },
]

export function Controls(p: Props) {
  return (
    <div className="controls" role="group" aria-label="Portrait controls">
      <div className="ctrl ctrl-actions">
        <button type="button" className="btn btn-primary" onClick={p.onReplay}>
          <span className="btn-key" aria-hidden>R</span>
          Replay
        </button>
        <button type="button" className="btn" onClick={p.onScatter}>
          <span className="btn-key" aria-hidden>S</span>
          Scatter
        </button>
      </div>

      <label className="ctrl ctrl-range">
        <span className="ctrl-label">
          Detail <span className="ctrl-value">{DETAIL_LEVELS[p.detail]} col</span>
        </span>
        <input
          type="range"
          min={0}
          max={p.maxDetail}
          step={1}
          value={p.detail}
          onChange={(e) => p.onDetail(Number(e.target.value))}
          aria-valuetext={`${DETAIL_LEVELS[p.detail]} columns`}
        />
      </label>

      <label className="ctrl ctrl-range">
        <span className="ctrl-label">
          Motion <span className="ctrl-value">{Math.round(p.motion * 100).toString().padStart(2, '0')}</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(p.motion * 100)}
          onChange={(e) => p.onMotion(Number(e.target.value) / 100)}
        />
      </label>

      <div className="ctrl ctrl-modes">
        <span className="ctrl-label">Characters</span>
        <div className="seg" role="radiogroup" aria-label="Character set">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={p.mode === m.id}
              className={`seg-btn${p.mode === m.id ? ' is-on' : ''}`}
              onClick={() => p.onMode(m.id)}
            >
              <span className="seg-sample" aria-hidden>{m.sample}</span>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ctrl ctrl-export">
        <button type="button" className="btn btn-ghost" onClick={p.onExport} disabled={p.exporting || p.busy}>
          {p.exporting ? 'Saving…' : 'Export PNG'}
          <span aria-hidden>↓</span>
        </button>
      </div>
    </div>
  )
}
