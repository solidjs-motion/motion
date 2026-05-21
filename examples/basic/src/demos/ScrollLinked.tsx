import { createScroll, createTransform, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// ScrollLinked — createScroll → createTransform → MotionValue-driven width.
// The fixed top bar tracks scrollYProgress directly; no animation engine in
// between, just MV-to-style binding. The spacer below makes the page tall
// enough to actually scroll.
// ---------------------------------------------------------------------------

export default function ScrollLinked() {
  const { scrollYProgress } = createScroll()
  const widthPct = createTransform(scrollYProgress, [0, 1], ["0%", "100%"])
  const motion = useMotion({ animate: { width: widthPct } })
  return (
    <div>
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
        <div {...motion({ style: { height: "100%", background: "tomato" } })} />
      </div>
      <p style={{ color: "var(--color-fg)", "margin-bottom": "2rem" }}>
        Scroll the page — the fixed bar at the top of the viewport tracks scrollYProgress from 0 to
        1.
      </p>
      <div style={{ height: "180vh" }}>
        <div
          style={{
            padding: "1rem",
            "border-radius": "8px",
            background: "var(--color-surface)",
            color: "var(--color-muted)",
          }}
        >
          Spacer content. The page is intentionally tall so the bar has somewhere to go.
        </div>
      </div>
    </div>
  )
}
