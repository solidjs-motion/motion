import { createSignal, type JSX } from "solid-js"
import { motion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// MotionProxyCreate — `motion.create(MyComponent)` HOC entry point.
//
// Wraps a user-defined component with motion's behavior. The wrapped
// component must forward props to a single DOM-element root — either by
// spreading `{...props}` on its root or by explicitly setting
// `ref={props.ref}` and `style={props.style}`. Solid doesn't have a
// `forwardRef` equivalent; the contract is enforced at runtime by a
// dev-mode warning if motion's ref never reaches the DOM.
//
// The wrapped component's own props (here: `title` and `tone`) compose
// with the full MotionOptions surface at the call site, so users get
// `<MotionCard title="..." tone="warning" animate={...} hover={...} />`
// — their original API extended with every motion option.
//
// Dev-mode warnings the HOC emits (you can trigger them by mis-wrapping):
//   - `motion.create(motion.div)` → "double-wrap" warning (two state
//     machines on the same root would race).
//   - Wrapping a component that doesn't forward `props.ref` to a DOM
//     element → "didn't receive motion's ref" warning, logged after
//     mount + a microtask so any deferred-ref chain has had a chance
//     to fire.
// ---------------------------------------------------------------------------

type CardTone = "info" | "success" | "warning"

type CardProps = {
  title: string
  tone?: CardTone
  children?: JSX.Element
  // Motion needs to reach the DOM root somehow. The simplest contract
  // is `{...props}` on a single element — Solid's ref is just an
  // optional prop, and the HOC's auto-injected motion ref rides along
  // with any user-supplied ref via mergeRefs inside m().
  ref?: (el: HTMLElement) => void
  style?: JSX.CSSProperties
  class?: string
}

const TONE_PALETTE: Record<CardTone, string> = {
  info: "linear-gradient(135deg, #2193b0, #6dd5ed)",
  success: "linear-gradient(135deg, #11998e, #38ef7d)",
  warning: "linear-gradient(135deg, #f7971e, #ffd200)",
}

function Card(props: CardProps) {
  const tone = (): CardTone => props.tone ?? "info"
  // IMPORTANT — we do NOT re-spread `props.style` into our explicit style
  // block. The HOC's `m()` returns props.style as the merged user+motion
  // initial style ({...user, ...initialStyle}); if we re-merged that here
  // every reactive prop change (like `tone` flipping) would write motion's
  // STATIC initial values (opacity:0, transform:...) back onto the element
  // via Solid's per-key style diff. Motion's actual current values, set by
  // WAA / commitStyles after the enter animation, would be clobbered and
  // the box would visually reset to its pre-animation state on every prop
  // change.
  //
  // Instead: Card's style block holds ONLY Card's own visual styling.
  // Motion's initial style reaches the DOM via `applyStaticStyle` inside
  // createMotion (which writes directly to `el.style` during the ref
  // callback), so Solid never tracks those keys and never re-applies them
  // on subsequent renders. WAA's writes stay intact.
  return (
    <article
      {...props}
      style={{
        padding: "1.25rem 1.5rem",
        "border-radius": "12px",
        background: TONE_PALETTE[tone()],
        color: "white",
        "box-shadow": "0 10px 24px rgba(0,0,0,0.15)",
        cursor: "pointer",
        "user-select": "none",
      }}
    >
      <div style={{ "font-size": "1.1rem", "font-weight": 700, "margin-bottom": "0.35rem" }}>
        {props.title}
      </div>
      <div style={{ opacity: 0.92, "font-size": "0.9rem" }}>{props.children}</div>
    </article>
  )
}

// motion.create wraps Card; the result accepts Card's original props
// (title, tone, children) AND every motion option (animate, hover,
// exit, drag, variants, …). Same component identity across reads.
const MotionCard = motion.create(Card)

export default function MotionProxyCreate() {
  const [tone, setTone] = createSignal<CardTone>("info")

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        <code>MotionCard = motion.create(Card)</code>. The wrapped component keeps its own props (
        <code>title</code>, <code>tone</code>) and gains the full motion surface (
        <code>animate</code>, <code>hover</code>, <code>press</code>, etc.).
        <code>Card</code> just spreads <code>{`{...props}`}</code> on its root element — Solid's ref
        + style flow through transparently.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", "margin-bottom": "1.5rem" }}>
        <button type="button" class="demo-button" onClick={() => setTone("info")}>
          tone: info
        </button>
        <button type="button" class="demo-button" onClick={() => setTone("success")}>
          tone: success
        </button>
        <button type="button" class="demo-button" onClick={() => setTone("warning")}>
          tone: warning
        </button>
      </div>
      <MotionCard
        title="Hover me, press me, drag me"
        tone={tone()}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        hover={{ scale: 1.04, y: -4 }}
        press={{ scale: 0.97 }}
        drag="x"
        dragConstraints={{ left: -80, right: 80 }}
        dragElastic={0.4}
        transition={{ type: "spring", stiffness: 360, damping: 28 }}
      >
        The same <code>Card</code> Component now responds to hover, press, and drag — and the tone
        prop is still reactive. <code>motion.create</code> didn't replace any of Card's original
        behavior; it composed motion on top.
      </MotionCard>
    </div>
  )
}
