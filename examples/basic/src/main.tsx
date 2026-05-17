import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import {
  createMotionValue,
  createReducedMotion,
  createScroll,
  createTransform,
  useMotion,
} from "solidjs-motion";

// ---------------------------------------------------------------------------
// FadeIn — the canonical mount-fade-and-slide-up. Demonstrates static useMotion,
// initial/animate, the transition default, and the data-motion-hydrated marker.
// ---------------------------------------------------------------------------

function FadeIn() {
  const motion = useMotion({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  });
  return (
    <h1
      {...motion({
        style: {
          "font-size": "2rem",
          "font-weight": 600,
          margin: "0 0 0.5rem",
        },
      })}
    >
      solidjs-motion is alive
    </h1>
  );
}

// ---------------------------------------------------------------------------
// Toggle — signal-driven animation. Demonstrates the reactive form of useMotion
// (the function-shaped options) and spring transitions.
// ---------------------------------------------------------------------------

function Toggle() {
  const [open, setOpen] = createSignal(false);
  const motion = useMotion(() => ({
    initial: "closed",
    variants: {
      open: {
        x: 200,
        scale: 1.2,
      },
      closed: {
        x: 0,
        scale: 1,
      },
    },
    animate: open() ? "open" : "closed",
    transition: { type: "spring", stiffness: 200, damping: 20 },
  }));
  return (
    <section style={{ "margin-bottom": "2rem" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "0.5rem 1rem",
          background: "#111",
          color: "white",
          border: 0,
          "border-radius": "6px",
          cursor: "pointer",
          "margin-bottom": "1rem",
        }}
      >
        toggle ({open() ? "open" : "closed"})
      </button>
      <div
        {...motion({
          style: {
            width: "80px",
            height: "80px",
            "border-radius": "12px",
            background: "linear-gradient(135deg, #ff8a00, #e52e71)",
          },
        })}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// SignalDrivenSize — demonstrates createMotionSignal: the Accessor reads
// reactively in JSX (so the button label updates), and the MotionValue drives
// the per-property animation in useMotion's target. MotionValues aren't Solid
// signals — Solid won't re-render on mv.get(); the Accessor bridges that gap.
// ---------------------------------------------------------------------------

function SignalDrivenSize() {
  // createMotionValue returns a callable hybrid: invoke `size()` for a
  // Solid-tracked read; call `size.set(...)` / `size.get()` for the
  // imperative MotionValue API. Same value drives the JSX text AND
  // useMotion's per-property animation target.
  const size = createMotionValue(80);
  const motion = useMotion({
    animate: { width: size, height: size },
  });
  return (
    <section style={{ "margin-bottom": "2rem" }}>
      <button
        type="button"
        onClick={() => size.set(size.get() + 20)}
        style={{
          padding: "0.5rem 1rem",
          background: "#111",
          color: "white",
          border: 0,
          "border-radius": "6px",
          cursor: "pointer",
          "margin-bottom": "1rem",
        }}
      >
        grow ({size()}px)
      </button>
      <div
        {...motion({
          style: {
            "border-radius": "12px",
            background: "linear-gradient(135deg, #00e5ff, #2979ff)",
          },
        })}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// ScrollLinked — createScroll → createTransform → MotionValue-driven style.
// The bar's width tracks scrollYProgress; no animation engine in between, just
// motion-value-to-style binding.
// ---------------------------------------------------------------------------

function ScrollLinked() {
  const { scrollYProgress } = createScroll();
  const widthPct = createTransform(scrollYProgress, [0, 1], ["0%", "100%"]);
  const motion = useMotion({ animate: { width: widthPct } });
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "4px",
        "z-index": 100,
        background: "rgba(0,0,0,0.06)",
      }}
    >
      <div
        {...motion({
          style: { height: "100%", background: "tomato" },
        })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReducedMotionStatus — surfaces the system pref via createReducedMotion.
// ---------------------------------------------------------------------------

function ReducedMotionStatus() {
  const reduced = createReducedMotion();
  return (
    <p style={{ color: "#666", "font-size": "0.875rem", "margin-top": "2rem" }}>
      prefers-reduced-motion: <strong>{String(reduced())}</strong>
    </p>
  );
}

// ---------------------------------------------------------------------------
// App — a tall page so the scroll-linked bar has something to track.
// ---------------------------------------------------------------------------

function App() {
  return (
    <main
      style={{
        "font-family": "system-ui, sans-serif",
        padding: "3rem",
        "max-width": "640px",
      }}
    >
      <ScrollLinked />
      <FadeIn />
      <p style={{ color: "#444", "margin-bottom": "2rem" }}>
        Phase 1 demos: mount-fade, signal-driven spring, MotionValue-driven
        size, scroll-linked progress bar (top), reduced-motion accessor.
      </p>
      <Toggle />
      <SignalDrivenSize />
      <ReducedMotionStatus />
      {/* Spacer to make the page scrollable for the progress bar */}
      <div style={{ height: "120vh" }} />
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
render(() => <App />, root);
