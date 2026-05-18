import { createDragControls, useMotion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// DragControls — the "drag handle" pattern (Q9). One element owns the drag,
// a DIFFERENT element captures the pointerdown that starts it. The
// controls instance is the bridge: `dragControls: controls` on the dragged
// element, `controls.start(event)` from the handle's onPointerDown.
//
// snapToCursor centers the dragged element under the pointer on start —
// the visible "jump to follow the cursor" you want when a tiny handle
// triggers a large element.
// ---------------------------------------------------------------------------

export default function DragControlsDemo() {
  const controls = createDragControls()

  // The actual draggable element. dragControls: controls registers it as
  // the target of externally-triggered drags. We still allow normal
  // pointer-on-element drags too (drag: true) — the two routes coexist.
  const motion = useMotion({
    drag: true,
    dragControls: controls,
    whileDrag: { scale: 1.05 },
    transition: { type: "spring", stiffness: 350, damping: 25 },
  })

  return (
    <div>
      <p style={{ color: "#444", "margin-bottom": "1rem" }}>
        Press <strong>the handle button</strong> below and drag — the card to the right follows even
        though the pointer never touches it. <code>snapToCursor</code> centers the card under the
        pointer at drag-start.
      </p>
      <div
        style={{
          display: "grid",
          "grid-template-columns": "auto 1fr",
          gap: "2rem",
          "align-items": "center",
        }}
      >
        <button
          type="button"
          // The handle's onPointerDown forwards to controls.start. The
          // pointerEvent passed in identifies the pointerId + start coords;
          // createDrag synthesizes its own pan session from there.
          onPointerDown={(event) => controls.start(event, { snapToCursor: true })}
          class="demo-button"
          style={{ padding: "1.5rem", cursor: "grab", "touch-action": "none" }}
        >
          drag handle
        </button>
        <div
          {...motion({
            style: {
              width: "120px",
              height: "120px",
              "border-radius": "16px",
              background: "linear-gradient(135deg, #ff8a00, #e52e71)",
              "touch-action": "none",
            },
          })}
        />
      </div>
    </div>
  )
}
