import { createSignal, Show } from "solid-js"
import { useAnimatePresence, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// UseAnimatePresenceHook — the imperative escape hatch. Where `<Presence>`
// coordinates exits automatically by watching its descendants, the hook hands
// orchestration back to YOU: register motion descendants under the returned
// Provider, then call `exit()` to dispatch every registered runExit in
// parallel. The promise resolves once they've all settled — at which point
// you flip your own mount signal.
//
// Use case: a "save" button that needs to wait for a network call AND for the
// card's exit animation to settle before flipping a "done" UI. Or route
// transitions where the router is the source of truth, not Solid signals.
// ---------------------------------------------------------------------------

export default function UseAnimatePresenceHook() {
  const [mounted, setMounted] = createSignal(true)
  const [savingState, setSavingState] = createSignal<"idle" | "saving" | "done">("idle")
  const presence = useAnimatePresence()

  const save = async () => {
    setSavingState("saving")
    // Fake network call alongside the exit animation. Promise.all means
    // we wait for whichever finishes LAST — useful when the work might
    // outlive the visual transition or vice versa.
    await Promise.all([presence.exit(), new Promise((r) => setTimeout(r, 400))])
    setMounted(false)
    setSavingState("done")
  }

  const reset = () => {
    setMounted(true)
    setSavingState("idle")
  }

  return (
    <div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "1rem" }}>
        "Save" runs the exit AND a fake 400ms network call in parallel. The card unmounts only after
        both settle — same shape every library-author uses for route transitions or async
        confirmation dialogs.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", "margin-bottom": "1.5rem" }}>
        <button
          type="button"
          class="demo-button"
          onClick={save}
          disabled={!mounted() || savingState() === "saving"}
        >
          {savingState() === "saving" ? "saving…" : "save (await exit)"}
        </button>
        <button type="button" class="demo-button" onClick={reset} disabled={mounted()}>
          reset
        </button>
        <span style={{ "align-self": "center", color: "var(--color-muted)", "font-size": "0.85rem" }}>
          state: <strong>{savingState()}</strong>
        </span>
      </div>
      <div style={{ "min-height": "140px" }}>
        <presence.Provider>
          <Show when={mounted()}>{(_v) => <Card />}</Show>
        </presence.Provider>
      </div>
    </div>
  )
}

function Card() {
  // The Provider returned by useAnimatePresence is just a thin wrapper over
  // PresenceContext.Provider — the motion child sees it the same way it
  // would inside `<Presence>` and registers its runExit.
  const motion = useMotion({
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -16, scale: 0.95 },
    transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] },
  })
  return (
    <div
      {...motion({
        style: {
          padding: "1.5rem",
          "border-radius": "12px",
          background: "linear-gradient(135deg, #11998e, #38ef7d)",
          color: "white",
          "font-weight": 600,
          "box-shadow": "0 8px 24px rgba(0,0,0,0.08)",
        },
      })}
    >
      <div style={{ "font-size": "1.2rem", "margin-bottom": "0.35rem" }}>Pending changes</div>
      <div style={{ opacity: 0.85, "font-size": "0.9rem" }}>
        Click "save" — I'll exit when both the animation and the (fake) network call settle.
      </div>
    </div>
  )
}
