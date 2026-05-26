import { createSignal, For } from "solid-js"
import { LayoutGroup, motion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// LayoutGroupNamespace — two parallel tab strips, each scoped by its own
// `<LayoutGroup>`. Both strips use the SAME `layoutId="indicator"` for
// the highlight, but because each strip has its own LayoutGroup
// (and therefore its own coordinator), clicking a tab in strip A
// only moves A's indicator. The indicator in strip B stays put.
//
// Removing the surrounding <LayoutGroup>s would let A's coordinator
// match B's donor (or vice versa) via the implicit root coordinator,
// causing the indicator to JUMP across strips when one swaps. The
// scoping is what isolates them.
// ---------------------------------------------------------------------------

const TABS = ["one", "two", "three"]

export default function LayoutGroupNamespace() {
  const [activeA, setActiveA] = createSignal(0)
  const [activeB, setActiveB] = createSignal(0)
  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        Two tab strips, identical structure. Both use <code>layoutId="indicator"</code>. Each strip
        is wrapped in its own
        <code>&lt;LayoutGroup&gt;</code> — the highlight animates within a strip but never crosses
        to the other strip.
      </p>
      <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "1.5rem" }}>
        <TabStrip label="Strip A" active={activeA()} setActive={setActiveA} />
        <TabStrip label="Strip B" active={activeB()} setActive={setActiveB} />
      </div>
    </div>
  )
}

function TabStrip(props: { label: string; active: number; setActive: (i: number) => void }) {
  return (
    <LayoutGroup>
      <div>
        <div
          style={{
            "font-size": "0.7rem",
            "text-transform": "uppercase",
            "letter-spacing": "0.08em",
            color: "var(--color-muted)",
            "margin-bottom": "0.5rem",
          }}
        >
          {props.label}
        </div>
        <div
          style={{
            display: "flex",
            gap: "0.25rem",
            padding: "0.25rem",
            "border-radius": "10px",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <For each={TABS}>
            {(label, i) => (
              <button
                type="button"
                onClick={() => props.setActive(i())}
                style={{
                  position: "relative",
                  flex: 1,
                  padding: "0.5rem 0.75rem",
                  border: "none",
                  background: "transparent",
                  color: "var(--color-fg)",
                  cursor: "pointer",
                  "font-size": "0.9rem",
                  "border-radius": "8px",
                }}
              >
                {props.active === i() && (
                  <motion.div
                    layoutId="indicator"
                    data-testid={`${props.label}/indicator/${i()}`}
                    transition={{ type: "spring", stiffness: 350, damping: 30 }}
                    style={{
                      position: "absolute",
                      inset: 0,
                      "border-radius": "8px",
                      background: "var(--color-elevated)",
                      border: "1px solid var(--color-border)",
                      "z-index": 0,
                    }}
                  />
                )}
                <span style={{ position: "relative", "z-index": 1 }}>{label}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </LayoutGroup>
  )
}
