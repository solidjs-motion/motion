import { createSignal, type JSX, onCleanup, Show } from "solid-js"
import { createMotionValue, motion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// SierpinskiTriangle — a port of Ryan Carniato's classic Solid stress demo
// (ryansolid/solid-sierpinski-triangle-demo), reframed to exercise the
// MV-in-style fan-out path.
//
// Two stress axes running over the same recursive tree:
//
//   1. **Continuous transform via MV-in-style.** Every Dot is a
//      `<motion.div style={{ scale: rootMV }}>` subscribing to ONE shared
//      MotionValue. A single rAF loop sets the MV to a sine wave (±10%,
//      ~1.5 Hz) — driving thousands of subscription notifies per frame.
//      Each notify hits the writer's single-key fast path (no target-object
//      allocation, no TRANSFORM_ORDER walk) and writes
//      `el.style.transform = "scale(<v>)"`. This is the motion-side path.
//
//   2. **Static text via Solid signal.** Every Dot also renders the
//      `seconds()` signal as its label. The signal updates once per second;
//      Solid's per-text-node fine-grained reactivity means each Dot's text
//      child re-evaluates independently. ~6,500 reactive bindings firing on
//      a 1 Hz signal — a separate stress axis on top of the visual one.
//
// Slider 4–9 lets you sweep through the difficulty curve:
//   4 →    81 dots (trivial)
//   6 →   729 dots
//   7 → 2,187 dots (default — smooth on most setups)
//   8 → 6,561 dots (matches the original demo's stress level)
//   9 → 19,683 dots (browser-dependent — at this density the compositor
//                    becomes the bottleneck even with cheap JS coordination)
//
// The FPS counter is the visual proof. Smooth at the chosen depth = the
// per-element JS + DOM-write overhead is well under a 16.7 ms frame.
// ---------------------------------------------------------------------------

const CONTAINER_W = 700
const CONTAINER_H = 600

/**
 * Initial half-size of the outer triangle. After N recursion halvings the
 * leaf-level triangle has size `TRIANGLE_S_INIT / 2 ** depth`. Picked so the
 * triangle's bounding box (~2 × TRIANGLE_S_INIT) fits inside the container
 * with a small margin.
 */
const TRIANGLE_S_INIT = CONTAINER_H * 0.45

type ScaleMV = ReturnType<typeof createMotionValue<number>>

/**
 * Map depth → leaf dot diameter (px) and font size (px).
 *
 * Sizing is anchored to the actual leaf-triangle edge length: each Triangle
 * recursion halves `s`, so the smallest triangle's edge is
 * `TRIANGLE_S_INIT / 2 ** depth`. Adjacent leaf-dots are at most ~s apart
 * (horizontal siblings) and at least ~s/2 apart (top/bottom siblings).
 *
 * A dot diameter of ~1.2 × leafSize makes adjacent dots touch lightly —
 * matches the canonical Sierpinski silhouette where the negative-space
 * triangles define the structure. We floor at 3px so the highest depths
 * stay visible as colored pixels rather than vanishing.
 */
function sizingForDepth(depth: number): { dot: number; font: number; showText: boolean } {
  const leafSize = TRIANGLE_S_INIT / 2 ** depth
  const dot = Math.max(3, Math.round(leafSize * 1.2))
  const font = Math.round(dot * 0.55)
  // Numbers only render when the dot is big enough to fit a 2-digit string.
  return { dot, font, showText: dot >= 18 }
}

function Dot(props: {
  x: number
  y: number
  size: number
  fontSize: number
  showText: boolean
  scale: ScaleMV
  seconds: () => number
}): JSX.Element {
  return (
    <motion.div
      style={{
        position: "absolute",
        left: `${props.x - props.size / 2}px`,
        top: `${props.y - props.size / 2}px`,
        width: `${props.size}px`,
        height: `${props.size}px`,
        "border-radius": "50%",
        background: "hsl(220, 70%, 55%)",
        color: "white",
        "font-size": `${props.fontSize}px`,
        "font-weight": "600",
        "font-variant-numeric": "tabular-nums",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        // NB: `will-change: transform` was tried here and is COUNTER-
        // PRODUCTIVE at this scale. Browsers cap composited-layer count
        // (~1000-2000 typical); with 6,500+ dots the hint forces too many
        // layers, exhausts GPU memory, and falls back to CPU for the
        // overflow — net slower than letting the browser auto-decide.
        // No cast needed — Stage 5's `MotionStyle` type widens `scale` (and
        // every other transform shortcut + CSS property) to accept
        // MotionValue. captureStyleEntries scrapes it into the registry at
        // mount and the writer fires per change.
        scale: props.scale,
      }}
    >
      {props.showText ? props.seconds() : null}
    </motion.div>
  )
}

function Triangle(props: {
  x: number
  y: number
  s: number
  depth: number
  scale: ScaleMV
  seconds: () => number
  dotSize: number
  fontSize: number
  showText: boolean
}): JSX.Element {
  if (props.depth === 0) {
    return (
      <Dot
        x={props.x}
        y={props.y}
        size={props.dotSize}
        fontSize={props.fontSize}
        showText={props.showText}
        scale={props.scale}
        seconds={props.seconds}
      />
    )
  }
  const s = props.s / 2
  return (
    <>
      <Triangle
        x={props.x}
        y={props.y - s / 2}
        s={s}
        depth={props.depth - 1}
        scale={props.scale}
        seconds={props.seconds}
        dotSize={props.dotSize}
        fontSize={props.fontSize}
        showText={props.showText}
      />
      <Triangle
        x={props.x - s}
        y={props.y + s / 2}
        s={s}
        depth={props.depth - 1}
        scale={props.scale}
        seconds={props.seconds}
        dotSize={props.dotSize}
        fontSize={props.fontSize}
        showText={props.showText}
      />
      <Triangle
        x={props.x + s}
        y={props.y + s / 2}
        s={s}
        depth={props.depth - 1}
        scale={props.scale}
        seconds={props.seconds}
        dotSize={props.dotSize}
        fontSize={props.fontSize}
        showText={props.showText}
      />
    </>
  )
}

export default function SierpinskiTriangle(): JSX.Element {
  const [depth, setDepth] = createSignal(7)
  const [fps, setFps] = createSignal(60)
  const [seconds, setSeconds] = createSignal(0)
  const scale = createMotionValue(1)

  // Single rAF loop drives the scale animation + FPS counter + seconds
  // counter. Anchoring all three avoids three independent rAF callbacks
  // competing for the frame.
  const start = performance.now()
  let frames = 0
  let lastFpsUpdate = start
  let lastSecondsUpdate = start
  let raf = 0
  const tick = (now: number): void => {
    // Pulse the shared scale MV between 0.1 and 1.0 — a dramatic shrink
    // that makes the per-element transform write visually obvious. Math:
    //   midpoint = (1.0 + 0.1) / 2 = 0.55
    //   amplitude = (1.0 - 0.1) / 2 = 0.45
    scale.set(0.55 + Math.sin((now - start) / 240) * 0.45)
    frames++
    if (now - lastFpsUpdate >= 1000) {
      setFps(Math.round((frames * 1000) / (now - lastFpsUpdate)))
      frames = 0
      lastFpsUpdate = now
    }
    if (now - lastSecondsUpdate >= 1000) {
      setSeconds(Math.floor((now - start) / 1000))
      lastSecondsUpdate = now
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  onCleanup(() => cancelAnimationFrame(raf))

  return (
    <div>
      <p style={{ color: "#444", "margin-bottom": "1rem" }}>
        Every dot is a <code>&lt;motion.div&gt;</code> with{" "}
        <code>style=&#123;&#123; scale: sharedMV &#125;&#125;</code> subscribing to one shared{" "}
        <code>createMotionValue</code> driven by a sine pulse. Each dot also renders the seconds
        signal — Solid's fine-grained text reactivity at scale. The FPS counter is the proof.
      </p>
      <div
        style={{
          display: "flex",
          gap: "1rem",
          "align-items": "center",
          "margin-bottom": "1rem",
          "flex-wrap": "wrap",
        }}
      >
        <label style={{ display: "flex", gap: "0.5rem", "align-items": "center" }}>
          <span>Depth:</span>
          <input
            type="range"
            min={4}
            max={9}
            step={1}
            value={depth()}
            onInput={(e) => setDepth(Number.parseInt(e.currentTarget.value, 10))}
          />
          <code style={{ "min-width": "10ch", display: "inline-block" }}>
            {depth()} ({(3 ** depth()).toLocaleString()})
          </code>
        </label>
        <code
          style={{
            "margin-left": "auto",
            padding: "0.25rem 0.6rem",
            background: fps() >= 55 ? "#d4edda" : fps() >= 30 ? "#fff3cd" : "#f8d7da",
            color: fps() >= 55 ? "#155724" : fps() >= 30 ? "#856404" : "#721c24",
            "border-radius": "4px",
            "font-variant-numeric": "tabular-nums",
            "min-width": "70px",
            "text-align": "center",
            "font-weight": 600,
          }}
        >
          {fps()} FPS
        </code>
      </div>
      <div
        style={{
          position: "relative",
          width: `${CONTAINER_W}px`,
          height: `${CONTAINER_H}px`,
          "max-width": "100%",
          background: "#fafafa",
          border: "1px solid #e5e5e5",
          "border-radius": "8px",
          overflow: "hidden",
        }}
      >
        {/* `Show keyed` re-mounts the entire triangle whenever depth changes.
            Without `keyed`, the component instance would persist and the
            recursive if-else inside Triangle wouldn't re-evaluate (Solid
            components don't re-run on prop change). */}
        <Show keyed when={depth()}>
          {(d) => {
            const sizing = sizingForDepth(d)
            return (
              <Triangle
                x={CONTAINER_W / 2}
                y={CONTAINER_H * 0.55}
                s={CONTAINER_H * 0.45}
                depth={d}
                scale={scale}
                seconds={seconds}
                dotSize={sizing.dot}
                fontSize={sizing.font}
                showText={sizing.showText}
              />
            )
          }}
        </Show>
      </div>
    </div>
  )
}
