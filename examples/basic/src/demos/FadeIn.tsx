import { useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// FadeIn — the canonical mount-fade-and-slide-up. Demonstrates static useMotion,
// initial/animate, the transition default, and the data-motion-hydrated marker.
// ---------------------------------------------------------------------------

export default function FadeIn() {
  const motion = useMotion({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  })
  return (
    <div
      {...motion({
        style: {
          padding: "2rem",
          "border-radius": "12px",
          background: "linear-gradient(135deg, #ff8a00, #e52e71)",
          color: "white",
          "font-weight": 600,
          "font-size": "1.25rem",
        },
      })}
    >
      I faded in. Reload the page to see it again.
    </div>
  )
}
