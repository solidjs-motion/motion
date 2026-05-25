import { createEffect, createMemo, createSignal, type JSX, onCleanup, Show } from "solid-js"
import { isServer } from "solid-js/web"
import { createMotionValue, LayoutGroup, motion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// SierpinskiTriangle — a port of Ryan Carniato's classic Solid stress demo
// (ryansolid/solid-sierpinski-triangle-demo), now reframed to exercise the
// LAYOUT-animation path at scale.
//
// Three stress axes layered on the same recursive tree:
//
//   1. **Layout FLIP at fan-out.** Every dot is a `<motion.div layout>`
//      inside a `<LayoutGroup dependency={shuffleTick}>`. A timer fires
//      every 2.5 s, Fisher-Yates shuffles a permutation that maps each
//      dot's stable identity to a leaf-position, and bumps `shuffleTick`.
//      The LayoutGroup broadcast re-fires every descendant's measurement;
//      each dot computes its delta and animates from its old slot to its
//      new one. At depth 5 that's 243 simultaneous translate animations;
//      at depth 7, 2,187.
//
//   2. **Continuous transform via MV-in-style.** Every Dot still subscribes
//      to a shared `scale: rootMV` driven by a sine pulse — the original
//      stress axis, kept here because the value-registry fold composes
//      user transforms with the layout layer. Each dot scales AND
//      translates simultaneously during a shuffle.
//
//   3. **Static text via Solid signal.** Every Dot also renders the
//      `seconds()` signal as its label. ~6,500 reactive bindings firing on
//      a 1 Hz signal — separate stress axis on top of the visual one.
//
// Slider 4–9 lets you sweep through the difficulty curve:
//   4 →    81 dots
//   5 →   243 dots (default — smooth shuffles on most setups)
//   6 →   729 dots
//   7 → 2,187 dots (shuffles are visibly heavy but still complete)
//   8 → 6,561 dots
//   9 → 19,683 dots (compositor + layout machinery saturated — useful
//                    failure mode for profiling, not for smooth demo)
//
// The FPS counter is the visual proof. Smooth shuffles at the chosen
// depth means N FLIPs / s × per-FLIP cost stays under the frame budget.
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

type Leaf = { x: number; y: number }

/**
 * Compute the leaf-position list for a Sierpinski tree of the given depth.
 * Same recursion as the previous Triangle component, but flattened to an
 * array so we can address each leaf by index for shuffling. Order is
 * top-down, left-to-right (the recursive walk's natural emit order).
 */
function computeLeafPositions(depth: number): Leaf[] {
  const out: Leaf[] = []
  function walk(x: number, y: number, s: number, d: number): void {
    if (d === 0) {
      out.push({ x, y })
      return
    }
    const ns = s / 2
    walk(x, y - ns / 2, ns, d - 1)
    walk(x - ns, y + ns / 2, ns, d - 1)
    walk(x + ns, y + ns / 2, ns, d - 1)
  }
  walk(CONTAINER_W / 2, CONTAINER_H * 0.55, TRIANGLE_S_INIT, depth)
  return out
}

/**
 * Map depth → leaf dot diameter (px) and font size (px). Same anchor as
 * the previous version — dot ≈ 1.2 × leaf-edge, font ≈ 0.55 × dot, 3 px
 * floor so the highest depths stay visible.
 */
function sizingForDepth(depth: number): { dot: number; font: number; showText: boolean } {
  const leafSize = TRIANGLE_S_INIT / 2 ** depth
  const dot = Math.max(3, Math.round(leafSize * 1.2))
  const font = Math.round(dot * 0.55)
  return { dot, font, showText: dot >= 18 }
}

/**
 * Fisher-Yates in-place shuffle. Mutates the input array and returns it
 * for ergonomic use in setSignal callbacks. Pure when called on a fresh
 * copy.
 */
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i] as T
    arr[i] = arr[j] as T
    arr[j] = tmp
  }
  return arr
}

type ScaleMV = ReturnType<typeof createMotionValue<number>>

function Dot(props: {
  pos: () => Leaf
  size: number
  fontSize: number
  showText: boolean
  scale: ScaleMV
  seconds: () => number
}): JSX.Element {
  return (
    <motion.div
      layout
      style={{
        position: "absolute",
        left: `${props.pos().x - props.size / 2}px`,
        top: `${props.pos().y - props.size / 2}px`,
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
        // Same MV-in-style fan-out as before. The writer composes this
        // with the layout layer's translate when a FLIP is in flight,
        // so the dot continues pulsing during the shuffle animation.
        scale: props.scale,
      }}
    >
      {props.showText ? props.seconds() : null}
    </motion.div>
  )
}

export default function SierpinskiTriangle(): JSX.Element {
  const [depth, setDepth] = createSignal(5)
  const [fps, setFps] = createSignal(60)
  const [seconds, setSeconds] = createSignal(0)
  const [shuffleEnabled, setShuffleEnabled] = createSignal(true)
  const scale = createMotionValue(1)

  // The fixed slot positions for the current depth — recomputed when the
  // depth changes (which also reseeds the permutation below).
  const positions = createMemo(() => computeLeafPositions(depth()))

  // permutation[i] = the slot index occupied by dot identity `i`.
  // Initialized to the identity permutation (each dot at its natural
  // slot) so the first paint is a fully-formed Sierpinski.
  const [permutation, setPermutation] = createSignal<number[]>([])
  createEffect(() => {
    const n = positions().length
    setPermutation(Array.from({ length: n }, (_, i) => i))
  })

  // `shuffleTick` drives the LayoutGroup's `dependency` accessor — each
  // increment broadcasts to every layout-active descendant, triggering a
  // re-measurement and a FLIP from old to new slot. Bumped on shuffle.
  const [shuffleTick, setShuffleTick] = createSignal(0)
  const dependency = () => shuffleTick()

  // Single rAF loop drives the scale MV + FPS counter + seconds counter.
  // Anchoring all three avoids three independent rAF callbacks competing
  // for the frame. Guarded behind `isServer` so SSR doesn't crash on the
  // undefined `requestAnimationFrame` / `performance` globals.
  if (!isServer) {
    const start = performance.now()
    let frames = 0
    let lastFpsUpdate = start
    let lastSecondsUpdate = start
    let raf = 0
    const tick = (now: number): void => {
      // Pulse the shared scale MV between 0.6 and 1.0 — high baseline
      // keeps the dots clearly visible even at low depths while still
      // giving an obvious breathing motion.
      //   midpoint  = (1.0 + 0.6) / 2 = 0.8
      //   amplitude = (1.0 - 0.6) / 2 = 0.2
      scale.set(0.8 + Math.sin((now - start) / 240) * 0.2)
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
  }

  // Shuffle timer. Fires every 2.5 s while enabled. Each tick:
  //   1. Fisher-Yates shuffles the permutation
  //   2. Increments shuffleTick → LayoutGroup broadcast → every dot
  //      re-measures and FLIPs from its old slot to its new one.
  // 2.5 s spacing comfortably exceeds the default ~450 ms layout
  // transition so animations settle between shuffles.
  if (!isServer) {
    let timerId: ReturnType<typeof setInterval> | undefined
    createEffect(() => {
      if (timerId !== undefined) clearInterval(timerId)
      if (!shuffleEnabled()) return
      timerId = setInterval(() => {
        setPermutation((prev) => shuffleInPlace([...prev]))
        setShuffleTick((n) => n + 1)
      }, 2500)
    })
    onCleanup(() => {
      if (timerId !== undefined) clearInterval(timerId)
    })
  }

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Every dot is a <code>&lt;motion.div layout&gt;</code> inside a{" "}
        <code>&lt;LayoutGroup dependency=&#123;shuffleTick&#125;&gt;</code>. A timer Fisher-Yates
        shuffles the dot-to-slot mapping every 2.5 s and bumps the dependency; the broadcast
        re-fires every descendant's measurement and each dot FLIPs from its old slot to its new one.
        Layered on top of the original stress demo's per-dot scale-pulse (shared MotionValue) and
        seconds-counter (Solid fine-grained text reactivity).
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
        <label style={{ display: "flex", gap: "0.5rem", "align-items": "center" }}>
          <input
            type="checkbox"
            checked={shuffleEnabled()}
            onChange={(e) => setShuffleEnabled(e.currentTarget.checked)}
          />
          <span>Shuffle every 2.5s</span>
        </label>
        <button
          type="button"
          class="demo-button"
          onClick={() => {
            setPermutation((prev) => shuffleInPlace([...prev]))
            setShuffleTick((n) => n + 1)
          }}
        >
          Shuffle now
        </button>
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
          background: "var(--color-surface)",
          border: "1px solid #e5e5e5",
          "border-radius": "8px",
          overflow: "hidden",
        }}
      >
        {/* `Show keyed` remounts the entire dot set on depth change. Going
            from depth 5 → 6 triples the dot count, so identities and slot
            positions are fundamentally different — a full remount is the
            correct shape rather than trying to re-key partial overlap. */}
        <Show keyed when={depth()}>
          {(d) => {
            const sizing = sizingForDepth(d)
            return (
              <LayoutGroup dependency={dependency}>
                {positions().map((_, i) => (
                  <Dot
                    pos={() => {
                      const slotIdx = permutation()[i] ?? i
                      return positions()[slotIdx] ?? positions()[i] ?? { x: 0, y: 0 }
                    }}
                    size={sizing.dot}
                    fontSize={sizing.font}
                    showText={sizing.showText}
                    scale={scale}
                    seconds={seconds}
                  />
                ))}
              </LayoutGroup>
            )
          }}
        </Show>
      </div>
    </div>
  )
}
