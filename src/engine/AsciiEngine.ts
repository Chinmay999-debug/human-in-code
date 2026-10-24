import { CELL_ASPECT, LumaGrid, sampleGrid } from './sampler'

export type CharMode = 'classic' | 'numbers' | 'symbols'
export type Phase = 'loading' | 'field' | 'assembling' | 'formed' | 'scattering' | 'error'

export interface EngineStatus {
  phase: Phase
  progress: number // 0..1 during assembling / scattering
  glyphs: number
  cols: number
  rows: number
}

// Ramps run from empty to dense. Index 0 is always a space (no glyph).
export const RAMPS: Record<CharMode, string> = {
  classic: ' .,:;irsXA253hMHGS#9B&@',
  numbers: ' .:1172347590680',
  symbols: " .'`-~:=+*^<>?%$#&@",
}

const SCRAMBLE = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789#%&@$*+=<>/\\|{}[]?!'

// Atlas rows: base white, then accent tints.
const TINTS = ['#f4f4f2', '#7ff7ff', '#ff6ee0', '#8dffb0', '#ff7a6b']
const T_WHITE = 0
const T_CYAN = 1
const T_MAGENTA = 2
const T_GREEN = 3
const T_RED = 4

const BG = '#030304'
const FONT_FAMILY = '"DM Mono", ui-monospace, SFMono-Regular, Menlo, monospace'

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4)

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

export interface EngineOptions {
  cols: number
  motion: number // 0..1
  mode: CharMode
  onStatus?: (s: EngineStatus) => void
}

export class AsciiEngine {
  private host: HTMLElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private bloom = document.createElement('canvas')
  private bctx: CanvasRenderingContext2D
  private atlas = document.createElement('canvas')

  private image: HTMLImageElement | null = null
  private grid: LumaGrid | null = null
  private opts: EngineOptions

  // Layout (CSS px unless noted).
  private W = 0
  private H = 0
  private dpr = 1
  private cw = 0
  private chh = 0
  private ox = 0
  private oy = 0
  private gw = 0 // atlas cell, device px
  private gh = 0
  private atlasChars = ''
  private charIndex = new Map<string, number>()
  private rampIdx: Uint16Array = new Uint16Array(0) // atlas index per ramp level
  private scrambleIdx: Uint16Array = new Uint16Array(0)

  // Particles, struct-of-arrays.
  private n = 0
  private gc = new Uint16Array(0) // grid col
  private gr = new Uint16Array(0) // grid row
  private lum = new Float32Array(0)
  private px = new Float32Array(0)
  private py = new Float32Array(0)
  private fx = new Float32Array(0) // transition origin
  private fy = new Float32Array(0)
  private sx = new Float32Array(0) // scatter destination
  private sy = new Float32Array(0)
  private vx = new Float32Array(0)
  private vy = new Float32Array(0)
  private rx = new Float32Array(0) // pointer repel offset
  private ry = new Float32Array(0)
  private delay = new Float32Array(0)
  private dur = new Float32Array(0)
  private curve = new Float32Array(0)
  private seed = new Float32Array(0)
  private glyph = new Uint16Array(0) // atlas index of resolved char
  private lockAt = new Float32Array(0) // time when a mode change settles

  // Ambient dust.
  private dustN = 0
  private dx = new Float32Array(0)
  private dy = new Float32Array(0)
  private dvx = new Float32Array(0)
  private dvy = new Float32Array(0)
  private dseed = new Float32Array(0)

  private phase: Phase = 'loading'
  private phaseStart = 0
  private phaseEnd = 0
  private afterScatter: 'field' | 'assemble' = 'field'
  private fieldUntil = Infinity
  private time = 0
  private lastTs = 0
  private raf = 0
  private running = false
  private destroyed = false
  private pointer = { x: 0, y: 0, active: false }
  private lastStatus = ''
  private lastPhase: Phase | '' = ''
  private lastCols = 0
  private lastStatusAt = 0
  private resizeObserver: ResizeObserver
  private reducedMotion: boolean

  constructor(host: HTMLElement, canvas: HTMLCanvasElement, opts: EngineOptions) {
    this.host = host
    this.canvas = canvas
    this.opts = { ...opts }
    this.ctx = canvas.getContext('2d', { alpha: false })!
    this.bctx = this.bloom.getContext('2d')!
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
    document.addEventListener('visibilitychange', this.onVisibility)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('pointercancel', this.onPointerLeave)

    this.resize()
    this.start()
  }

  // ---------------------------------------------------------------- public

  setImage(img: HTMLImageElement) {
    this.image = img
    this.rebuild(true)
    // Let the floating field breathe before the portrait assembles.
    this.setPhase('field')
    this.fieldUntil = this.time + (this.reducedMotion ? 0.2 : 1.6)
  }

  setError() {
    this.setPhase('error')
  }

  setCols(cols: number) {
    if (cols === this.opts.cols) return
    this.opts.cols = cols
    if (this.image) this.rebuild(false)
  }

  setMotion(m: number) {
    this.opts.motion = m
  }

  setMode(mode: CharMode) {
    if (mode === this.opts.mode) return
    this.opts.mode = mode
    this.buildRampIndex()
    // Decode wave: glyphs scramble briefly then settle, sweeping top-down.
    const rows = this.grid?.rows ?? 1
    for (let i = 0; i < this.n; i++) {
      this.lockAt[i] = this.time + 0.15 + (this.gr[i] / rows) * 0.7 + this.seed[i] * 0.25
    }
    this.resolveGlyphs()
  }

  replay() {
    if (!this.grid) return
    if (this.phase === 'field') {
      this.assemble()
      return
    }
    this.scatter('assemble')
  }

  scatter(next: 'field' | 'assemble' = 'field') {
    if (!this.grid) return
    this.afterScatter = next
    const fast = next === 'assemble'
    for (let i = 0; i < this.n; i++) {
      this.fx[i] = this.px[i] + this.rx[i]
      this.fy[i] = this.py[i] + this.ry[i]
      this.rx[i] = this.ry[i] = 0
      const p = this.randomFieldPoint()
      this.sx[i] = p[0]
      this.sy[i] = p[1]
      this.delay[i] = Math.random() * (fast ? 0.25 : 0.35)
      this.dur[i] = (fast ? 0.7 : 0.9) + Math.random() * 0.6
    }
    this.setPhase('scattering')
    this.phaseEnd = this.time + (fast ? 0.25 + 1.3 : 0.35 + 1.5)
  }

  exportPNG(): Promise<Blob | null> {
    const out = document.createElement('canvas')
    out.width = this.canvas.width
    out.height = this.canvas.height
    const o = out.getContext('2d')!
    o.drawImage(this.canvas, 0, 0)
    const s = this.dpr
    o.font = `400 ${10 * s}px ${FONT_FAMILY}`
    o.fillStyle = 'rgba(255,255,255,0.5)'
    o.textBaseline = 'bottom'
    o.fillText('FOR AAYUSHI — A PORTRAIT IN CODE', 16 * s, out.height - 14 * s)
    o.textAlign = 'right'
    const g = this.grid
    if (g) o.fillText(`${g.cols}×${g.rows} · ${this.n} GLYPHS`, out.width - 16 * s, out.height - 14 * s)
    return new Promise((resolve) => out.toBlob(resolve, 'image/png'))
  }

  destroy() {
    this.destroyed = true
    this.stop()
    this.resizeObserver.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.canvas.removeEventListener('pointercancel', this.onPointerLeave)
  }

  // ---------------------------------------------------------------- loop

  private start() {
    if (this.running || this.destroyed) return
    this.running = true
    this.lastTs = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  private stop() {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  private onVisibility = () => {
    if (document.hidden) this.stop()
    else this.start()
  }

  private onPointerMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect()
    this.pointer.x = e.clientX - r.left
    this.pointer.y = e.clientY - r.top
    this.pointer.active = e.pointerType === 'mouse' || e.pointerType === 'pen'
  }

  private onPointerLeave = () => {
    this.pointer.active = false
  }

  private frame = (ts: number) => {
    if (!this.running) return
    // Clamp dt so a stalled tab never fast-forwards the animation.
    const dt = Math.min(0.05, Math.max(0, (ts - this.lastTs) / 1000))
    this.lastTs = ts
    this.time += dt
    this.update(dt)
    this.render()
    this.raf = requestAnimationFrame(this.frame)
  }

  // ---------------------------------------------------------------- setup

  private resize() {
    const rect = this.host.getBoundingClientRect()
    const W = Math.max(1, Math.round(rect.width))
    const H = Math.max(1, Math.round(rect.height))
    // Cap DPR, and keep the backing store under ~3.2 MP so fill rate stays sane.
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(3.2e6 / (W * H)))
    if (W === this.W && H === this.H && dpr === this.dpr) return

    const sxScale = this.W ? W / this.W : 1
    const syScale = this.H ? H / this.H : 1
    this.W = W
    this.H = H
    this.dpr = dpr

    this.canvas.width = Math.round(W * dpr)
    this.canvas.height = Math.round(H * dpr)
    this.canvas.style.width = `${W}px`
    this.canvas.style.height = `${H}px`
    this.bloom.width = Math.max(1, Math.round(W / 4))
    this.bloom.height = Math.max(1, Math.round(H / 4))

    // Keep free-floating particles proportionally placed.
    for (let i = 0; i < this.n; i++) {
      this.px[i] *= sxScale
      this.py[i] *= syScale
      this.fx[i] *= sxScale
      this.fy[i] *= syScale
      this.sx[i] *= sxScale
      this.sy[i] *= syScale
    }
    for (let i = 0; i < this.dustN; i++) {
      this.dx[i] *= sxScale
      this.dy[i] *= syScale
    }
    if (!this.dustN) this.initDust()
    this.layout()
    this.render()
  }

  /** Fit the portrait grid into the frame and rebuild the glyph atlas. */
  private layout() {
    const g = this.grid
    if (!g) return
    const pad = this.W < 640 ? 0.94 : 0.9
    const gridAspect = (g.cols * 1) / (g.rows * CELL_ASPECT)
    let pw = this.W * pad
    let ph = pw / gridAspect
    if (ph > this.H * pad) {
      ph = this.H * pad
      pw = ph * gridAspect
    }
    this.cw = pw / g.cols
    this.chh = this.cw * CELL_ASPECT
    this.ox = (this.W - pw) / 2 + this.cw / 2
    this.oy = (this.H - ph) / 2 + this.chh / 2
    this.buildAtlas()
  }

  private buildAtlas() {
    const chars = new Set<string>(SCRAMBLE)
    for (const r of Object.values(RAMPS)) for (const c of r) if (c !== ' ') chars.add(c)
    chars.add('·')
    this.atlasChars = [...chars].join('')
    this.charIndex.clear()
    ;[...this.atlasChars].forEach((c, i) => this.charIndex.set(c, i))

    const fontPx = this.cw * 1.62 * this.dpr
    // Generous cells: room for the baked RGB fringe and glow.
    this.gw = Math.ceil(this.cw * this.dpr * 2.4) + 4
    this.gh = Math.ceil(this.chh * this.dpr * 1.4) + 4
    const count = this.atlasChars.length
    this.atlas.width = this.gw * count
    this.atlas.height = this.gh * TINTS.length
    const a = this.atlas.getContext('2d')!
    a.clearRect(0, 0, this.atlas.width, this.atlas.height)
    a.font = `400 ${fontPx}px ${FONT_FAMILY}`
    a.textAlign = 'center'
    a.textBaseline = 'middle'
    // Each glyph is pre-rendered with a cyan/magenta chromatic split and a
    // soft glow, so per-frame drawing is a single blit per character.
    const fringe = Math.max(0.6, fontPx * 0.07)
    a.globalCompositeOperation = 'lighter'
    TINTS.forEach((tint, row) => {
      const y = row * this.gh + this.gh / 2 + fontPx * 0.04
      for (let i = 0; i < count; i++) {
        const ch = this.atlasChars[i]
        const x = i * this.gw + this.gw / 2
        a.shadowBlur = 0
        a.globalAlpha = 0.5
        a.fillStyle = '#00e5ff'
        a.fillText(ch, x - fringe, y - fringe * 0.2)
        a.fillStyle = '#ff1fb4'
        a.fillText(ch, x + fringe, y + fringe * 0.2)
        a.globalAlpha = 1
        a.shadowColor = row === T_WHITE ? 'rgba(255,255,255,0.55)' : tint
        a.shadowBlur = fontPx * 0.35
        a.fillStyle = tint
        a.fillText(ch, x, y)
      }
    })
    a.shadowBlur = 0
    a.globalCompositeOperation = 'source-over'
    this.buildRampIndex()
    this.resolveGlyphs()
  }

  private buildRampIndex() {
    const ramp = RAMPS[this.opts.mode]
    this.rampIdx = new Uint16Array(ramp.length)
    for (let i = 0; i < ramp.length; i++) this.rampIdx[i] = this.charIndex.get(ramp[i]) ?? 0
    this.scrambleIdx = new Uint16Array(SCRAMBLE.length)
    for (let i = 0; i < SCRAMBLE.length; i++) this.scrambleIdx[i] = this.charIndex.get(SCRAMBLE[i]) ?? 0
  }

  private resolveGlyphs() {
    const ramp = RAMPS[this.opts.mode]
    const L = ramp.length - 1
    for (let i = 0; i < this.n; i++) {
      // Level 0 is never stored as a particle, so map into 1..L.
      const lv = Math.max(1, Math.min(L, Math.round(this.lum[i] * L)))
      this.glyph[i] = this.rampIdx[lv]
    }
  }

  /**
   * Resample the portrait at the current detail and rebuild particles.
   * When particles already exist, new ones inherit nearby old positions so a
   * detail change morphs instead of resetting.
   */
  private rebuild(initial: boolean) {
    if (!this.image) return
    const g = sampleGrid(this.image, this.opts.cols)
    this.grid = g
    const L = RAMPS.classic.length - 1

    const cells: number[] = []
    for (let i = 0; i < g.data.length; i++) {
      if (Math.round(g.data[i] * L) >= 1) cells.push(i)
    }
    const n = cells.length

    const oldN = this.n
    const oldPx = this.px
    const oldPy = this.py

    this.n = n
    this.gc = new Uint16Array(n)
    this.gr = new Uint16Array(n)
    this.lum = new Float32Array(n)
    this.px = new Float32Array(n)
    this.py = new Float32Array(n)
    this.fx = new Float32Array(n)
    this.fy = new Float32Array(n)
    this.sx = new Float32Array(n)
    this.sy = new Float32Array(n)
    this.vx = new Float32Array(n)
    this.vy = new Float32Array(n)
    this.rx = new Float32Array(n)
    this.ry = new Float32Array(n)
    this.delay = new Float32Array(n)
    this.dur = new Float32Array(n)
    this.curve = new Float32Array(n)
    this.seed = new Float32Array(n)
    this.glyph = new Uint16Array(n)
    this.lockAt = new Float32Array(n)

    for (let k = 0; k < n; k++) {
      const cell = cells[k]
      this.gc[k] = cell % g.cols
      this.gr[k] = Math.floor(cell / g.cols)
      this.lum[k] = g.data[cell]
      this.seed[k] = Math.random()
      this.curve[k] = (Math.random() - 0.5) * 0.9
      const a = Math.random() * Math.PI * 2
      const sp = 4 + Math.random() * 14
      this.vx[k] = Math.cos(a) * sp
      this.vy[k] = Math.sin(a) * sp - 3
    }
    this.layout()

    if (initial || !oldN) {
      for (let k = 0; k < n; k++) {
        const p = this.randomFieldPoint()
        this.px[k] = p[0]
        this.py[k] = p[1]
      }
      return
    }

    // Morph: start from the proportional old particle (row-major, so nearby).
    for (let k = 0; k < n; k++) {
      const j = Math.min(oldN - 1, Math.floor((k / n) * oldN))
      this.px[k] = oldPx[j] + (Math.random() - 0.5) * this.cw * 2
      this.py[k] = oldPy[j] + (Math.random() - 0.5) * this.chh
    }
    if (this.phase === 'field' || this.phase === 'scattering') {
      this.setPhase('field')
      this.fieldUntil = Infinity
    } else {
      this.assemble(true)
    }
  }

  private randomFieldPoint(): [number, number] {
    // Mostly uniform across the frame, biased slightly toward the edges.
    const u = Math.random()
    const v = Math.random()
    const bias = (t: number) => (t < 0.5 ? 0.5 - Math.pow(0.5 - t, 0.8) * 0.87 : 0.5 + Math.pow(t - 0.5, 0.8) * 0.87)
    const x = bias(u) * this.W
    const y = bias(v) * this.H
    return [x, y]
  }

  private initDust() {
    const count = this.W < 640 ? 70 : 140
    this.dustN = count
    this.dx = new Float32Array(count)
    this.dy = new Float32Array(count)
    this.dvx = new Float32Array(count)
    this.dvy = new Float32Array(count)
    this.dseed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      this.dx[i] = Math.random() * this.W
      this.dy[i] = Math.random() * this.H
      this.dvx[i] = (Math.random() - 0.5) * 8
      this.dvy[i] = -2 - Math.random() * 7
      this.dseed[i] = Math.random()
    }
  }

  // ---------------------------------------------------------------- state

  private setPhase(p: Phase) {
    this.phase = p
    this.phaseStart = this.time
  }

  private assemble(quick = false) {
    const g = this.grid
    if (!g) return
    const ccol = g.cols * 0.48
    const crow = g.rows * 0.4
    const maxD = Math.hypot(g.cols * 0.6, g.rows * 0.65)
    let end = 0
    const spread = quick ? 0.5 : this.reducedMotion ? 0.3 : 1.7
    for (let i = 0; i < this.n; i++) {
      this.fx[i] = this.px[i] + this.rx[i]
      this.fy[i] = this.py[i] + this.ry[i]
      this.rx[i] = this.ry[i] = 0
      // Stagger from the centre of the face outward, with organic jitter.
      const d = Math.min(1, Math.hypot(this.gc[i] - ccol, (this.gr[i] - crow) * 1.2) / maxD)
      this.delay[i] = d * spread + Math.random() * spread * 0.35
      this.dur[i] = quick ? 0.6 + Math.random() * 0.4 : this.reducedMotion ? 0.5 : 1.1 + Math.random() * 0.9
      end = Math.max(end, this.delay[i] + this.dur[i])
    }
    this.setPhase('assembling')
    this.phaseEnd = this.time + end
  }

  private update(dt: number) {
    const motion = this.opts.motion
    const W = this.W
    const H = this.H

    if (this.phase === 'field') {
      const sp = 0.25 + motion * 1.1
      for (let i = 0; i < this.n; i++) {
        let x = this.px[i] + this.vx[i] * dt * sp
        let y = this.py[i] + this.vy[i] * dt * sp
        if (x < -10) x += W + 20
        else if (x > W + 10) x -= W + 20
        if (y < -10) y += H + 20
        else if (y > H + 10) y -= H + 20
        this.px[i] = x
        this.py[i] = y
      }
      if (this.time >= this.fieldUntil) {
        this.fieldUntil = Infinity
        this.assemble()
      }
    } else if (this.phase === 'assembling' || this.phase === 'scattering') {
      const assembling = this.phase === 'assembling'
      const t0 = this.phaseStart
      for (let i = 0; i < this.n; i++) {
        let t = (this.time - t0 - this.delay[i]) / this.dur[i]
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const e = assembling ? easeInOutCubic(t) : easeOutQuart(t)
        const tx = assembling ? this.ox + this.gc[i] * this.cw : this.sx[i]
        const ty = assembling ? this.oy + this.gr[i] * this.chh : this.sy[i]
        const ddx = tx - this.fx[i]
        const ddy = ty - this.fy[i]
        // Arc the flight path sideways for an organic swirl.
        const arc = Math.sin(Math.PI * e) * this.curve[i]
        this.px[i] = this.fx[i] + ddx * e - ddy * arc
        this.py[i] = this.fy[i] + ddy * e + ddx * arc
      }
      if (this.time >= this.phaseEnd) {
        if (assembling) {
          this.setPhase('formed')
        } else if (this.afterScatter === 'assemble') {
          this.assemble()
        } else {
          this.setPhase('field')
          this.fieldUntil = Infinity
        }
      }
    } else if (this.phase === 'formed') {
      // Spring the pointer repel offsets.
      const R = Math.max(60, this.cw * 18)
      const R2 = R * R
      const pa = this.pointer.active
      const mx = this.pointer.x
      const my = this.pointer.y
      const k = 1 - Math.pow(0.0008, dt)
      for (let i = 0; i < this.n; i++) {
        const tx = this.ox + this.gc[i] * this.cw
        const ty = this.oy + this.gr[i] * this.chh
        let gx = 0
        let gy = 0
        if (pa) {
          const ddx = tx - mx
          const ddy = ty - my
          const d2 = ddx * ddx + ddy * ddy
          if (d2 < R2 && d2 > 0.01) {
            const d = Math.sqrt(d2)
            const f = (1 - d / R) * (1 - d / R) * R * 0.32
            gx = (ddx / d) * f
            gy = (ddy / d) * f
          }
        }
        this.rx[i] += (gx - this.rx[i]) * k
        this.ry[i] += (gy - this.ry[i]) * k
        this.px[i] = tx
        this.py[i] = ty
      }
    }

    // Dust always drifts.
    const dsp = 0.4 + motion
    for (let i = 0; i < this.dustN; i++) {
      let x = this.dx[i] + this.dvx[i] * dt * dsp
      let y = this.dy[i] + this.dvy[i] * dt * dsp
      if (y < -4) {
        y = H + 4
        x = Math.random() * W
      }
      if (x < -4) x = W + 4
      else if (x > W + 4) x = -4
      this.dx[i] = x
      this.dy[i] = y
    }

    this.emitStatus()
  }

  private emitStatus() {
    const cb = this.opts.onStatus
    if (!cb) return
    let progress = 0
    if (this.phase === 'assembling' || this.phase === 'scattering') {
      progress = Math.min(1, (this.time - this.phaseStart) / Math.max(0.001, this.phaseEnd - this.phaseStart))
    } else if (this.phase === 'formed') progress = 1
    const s: EngineStatus = {
      phase: this.phase,
      progress: Math.round(progress * 100) / 100,
      glyphs: this.n,
      cols: this.grid?.cols ?? 0,
      rows: this.grid?.rows ?? 0,
    }
    const key = `${s.phase}|${s.progress}|${s.glyphs}|${s.cols}`
    if (key === this.lastStatus) return
    const now = performance.now()
    // Throttle progress ticks; phase and grid changes go out immediately.
    if (s.phase === this.lastPhase && s.cols === this.lastCols && now - this.lastStatusAt < 80) return
    this.lastStatus = key
    this.lastPhase = s.phase
    this.lastCols = s.cols
    this.lastStatusAt = now
    cb(s)
  }

  // ---------------------------------------------------------------- render

  private render() {
    const ctx = this.ctx
    const cw = this.canvas.width
    const chh = this.canvas.height
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, cw, chh)
    if (!this.grid || !this.gw) {
      this.drawDust()
      return
    }

    ctx.globalCompositeOperation = 'lighter'
    this.drawGlyphs()

    // Cheap bloom: quarter-res copy scaled back up.
    const b = this.bctx
    b.globalCompositeOperation = 'copy'
    b.drawImage(this.canvas, 0, 0, this.bloom.width, this.bloom.height)
    ctx.imageSmoothingEnabled = true
    ctx.globalAlpha = this.phase === 'formed' ? 0.16 : 0.22
    ctx.drawImage(this.bloom, 0, 0, cw, chh)

    ctx.globalCompositeOperation = 'source-over'
    this.drawDust()
    ctx.globalAlpha = 1
  }

  private drawGlyphs() {
    const l = this.ctx
    const dpr = this.dpr
    const gw = this.gw
    const gh = this.gh
    const hx = gw / 2
    const hy = gh / 2
    const atlas = this.atlas
    const time = this.time
    const phase = this.phase
    const motion = this.opts.motion
    const amp = motion * this.cw * 0.45
    const scr = this.scrambleIdx
    const scrN = scr.length
    const flickTick = Math.floor(time * 14)
    const t0 = this.phaseStart
    const fieldFade = phase === 'field' ? Math.min(1, (time - t0) / 0.8) : 1
    const shimmerT = time * 0.9
    const hueT = time * 0.12

    for (let i = 0; i < this.n; i++) {
      const s = this.seed[i]
      const lum = this.lum[i]
      let x = this.px[i]
      let y = this.py[i]
      let alpha: number
      let gi = this.glyph[i]
      let tint = T_WHITE
      // Local progress toward the portrait, 0 (free) .. 1 (seated).
      let seat = 0

      if (phase === 'formed') {
        seat = 1
      } else if (phase === 'assembling') {
        const t = (time - t0 - this.delay[i]) / this.dur[i]
        seat = t < 0 ? 0 : t > 1 ? 1 : t
      } else if (phase === 'scattering') {
        const t = (time - t0 - this.delay[i]) / this.dur[i]
        seat = 1 - (t < 0 ? 0 : t > 1 ? 1 : t)
      }

      const finalAlpha = 0.16 + 0.84 * lum
      if (seat >= 1) {
        // Idle breathing around the seat.
        if (amp > 0) {
          x += Math.sin(time * 0.9 + s * 40) * amp * (0.4 + s * 0.6)
          y += Math.cos(time * 0.75 + s * 23) * amp * 0.5
        }
        x += this.rx[i]
        y += this.ry[i]
        alpha = finalAlpha

        // Controlled shimmer: a slow diagonal band picks up colour.
        const tx = this.gc[i]
        const ty = this.gr[i]
        const w = Math.sin(tx * 0.09 + ty * 0.06 - shimmerT + lum * 1.5)
        if (w > 0.95 && s > 0.3) {
          const band = (tx * 0.004 + ty * 0.003 + hueT + s * 0.15) % 1
          tint = band < 0.36 ? T_CYAN : band < 0.7 ? T_MAGENTA : T_GREEN
          alpha = Math.min(1, alpha + 0.12)
        } else if (hash(i * 0.37 + Math.floor(time * 1.6 + s * 9)) < 0.0035 * (0.4 + motion)) {
          // Rare sparks, occasionally red.
          tint = s < 0.08 ? T_RED : s < 0.4 ? T_CYAN : s < 0.75 ? T_MAGENTA : T_GREEN
          alpha = 1
        }
        if (time < this.lockAt[i]) {
          gi = scr[(flickTick + ((s * 997) | 0)) % scrN]
          tint = s < 0.3 ? T_CYAN : s < 0.5 ? T_MAGENTA : T_WHITE
        }
      } else {
        // Free or flying: scrambled glyphs, dim, occasional colour.
        const fieldAlpha = (0.14 + 0.34 * s) * (0.65 + 0.35 * Math.sin(time * 2.2 + s * 50)) * fieldFade
        alpha = fieldAlpha + (finalAlpha - fieldAlpha) * seat
        if (seat < 0.82) {
          const rate = seat > 0 ? 1 : 0.18
          gi = scr[(Math.floor(flickTick * rate + s * 31) + ((s * 997) | 0)) % scrN]
          if (seat > 0.05) {
            tint = s < 0.22 ? T_CYAN : s < 0.36 ? T_MAGENTA : s < 0.44 ? T_GREEN : T_WHITE
          } else if (s > 0.94) {
            tint = s > 0.98 ? T_MAGENTA : T_CYAN
          }
        }
      }

      if (alpha <= 0.01) continue
      l.globalAlpha = alpha > 1 ? 1 : alpha
      l.drawImage(atlas, gi * gw, tint * gh, gw, gh, Math.round(x * dpr - hx), Math.round(y * dpr - hy), gw, gh)
    }
    l.globalAlpha = 1
  }

  private drawDust() {
    const ctx = this.ctx
    const dpr = this.dpr
    const t = this.time
    for (let i = 0; i < this.dustN; i++) {
      const s = this.dseed[i]
      const a = (0.08 + 0.3 * s) * (0.5 + 0.5 * Math.sin(t * (1 + s * 2) + s * 30))
      ctx.globalAlpha = a
      ctx.fillStyle = s > 0.9 ? '#7ff7ff' : s > 0.82 ? '#ff6ee0' : s > 0.77 ? '#8dffb0' : '#ffffff'
      const r = (s > 0.7 ? 1.4 : 0.9) * dpr
      ctx.fillRect(this.dx[i] * dpr, this.dy[i] * dpr, r, r)
    }
    ctx.globalAlpha = 1
  }
}
