import { createSignal, For } from "solid-js"
import { useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// VariantOrchestration — parent controls staggered children animations.
//
// The pattern (motion/react parity):
//   1. Parent declares variants with labels ("open" / "closed").
//   2. Parent wraps its children in `m.Provider` so descendants inherit the
//      current label via VariantContext.
//   3. Each child passes its own `custom` (its index) and defines DYNAMIC
//      variants — functions of the custom value — so `delay` (and any other
//      per-target value) can be a function of position.
//   4. Toggling the parent's animate label re-runs each child's variant
//      function with its index, producing a staggered cascade.
//
// Children are passive consumers: they have no animate prop of their own,
// so the parent's label cascades through (Q4 + isControllingVariants rule).
// ---------------------------------------------------------------------------

const ITEMS = ["fade", "slide", "scale", "rotate", "spring", "tween"]

export default function VariantOrchestration() {
  const [open, setOpen] = createSignal(true)

  const motion = useMotion(() => ({
    initial: "closed",
    animate: open() ? "open" : "closed",
    variants: {
      open: { opacity: 1 },
      closed: { opacity: 0.4 },
    },
    transition: { duration: 0.3 },
  }))

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Toggle the parent below. Each <code>&lt;Item&gt;</code> inherits the parent's variant label
        via <code>m.Provider</code>, and its dynamic variant uses <code>custom</code> (the index) to
        compute a staggered <code>delay</code>.
      </p>
      <button
        type="button"
        class="demo-button"
        onClick={() => setOpen((o) => !o)}
        style={{ "margin-bottom": "1.5rem" }}
      >
        {open() ? "close" : "open"} list
      </button>
      <ul
        {...motion({
          style: {
            "list-style": "none",
            padding: "1rem",
            margin: 0,
            "border-radius": "12px",
            background: "var(--color-surface)",
            display: "grid",
            gap: "0.5rem",
          },
        })}
      >
        <motion.Provider>
          <For each={ITEMS}>{(label, i) => <Item index={i()} label={label} />}</For>
        </motion.Provider>
      </ul>
    </div>
  )
}

function Item(props: { index: number; label: string }) {
  // No own `animate` prop — this child is PASSIVE. It inherits the
  // parent's active label ("open" / "closed") via the VariantContext that
  // m.Provider exposes, then resolves that label against its own variants
  // map. Each variant is a function that receives `custom` (the index).
  const m = useMotion(() => ({
    custom: props.index,
    variants: {
      // `custom` is typed `unknown` on the variants index signature so each
      // function narrows it itself. We pass `props.index` (a number) above
      // and read it as a number here.
      open: (custom) => {
        const i = custom as number
        return {
          opacity: 1,
          x: 0,
          transition: {
            delay: i * 0.07,
            duration: 0.35,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        }
      },
      closed: (custom) => {
        const i = custom as number
        return {
          opacity: 0,
          x: -16,
          transition: {
            // Reverse stagger on close — last item leaves first.
            delay: (ITEMS.length - 1 - i) * 0.04,
            duration: 0.2,
          },
        }
      },
    },
  }))
  return (
    <li
      {...m({
        style: {
          padding: "0.5rem 0.75rem",
          background: "var(--color-elevated)",
          "border-radius": "8px",
          border: "1px solid var(--color-border)",
          "font-family": "ui-monospace, monospace",
          "font-size": "0.9rem",
        },
      })}
    >
      {props.index}. {props.label}
    </li>
  )
}
