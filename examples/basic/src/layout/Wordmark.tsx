import { Show } from "solid-js"
import { createReducedMotion, motion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// Wordmark — the "solidjs-motion" lockup with a small piece of branded
// movement: under the "motion" word, a soft blue sheen scrolls
// left-to-right across an otherwise-static yellow underline. The
// metaphor: Solid's energy passing through motion's surface — each
// color carries its own ecosystem's identity.
//
// Built with the lib itself (motion.span + animate-loop) so the demo
// gallery's chrome is also a demo. `createReducedMotion()` gates the
// sheen so anyone with `prefers-reduced-motion: reduce` gets the
// static underline — no shimmer, no transform churn.
// ---------------------------------------------------------------------------

export function Wordmark() {
  const reduced = createReducedMotion()
  return (
    <>
      <span class="text-primary">solidjs-</span>
      <span class="relative inline-block text-primary">
        motion
        <span
          aria-hidden="true"
          class="pointer-events-none absolute inset-x-0 -bottom-0.5 h-0.5 overflow-hidden rounded-full bg-accent"
        >
          <Show when={!reduced()}>
            <motion.span
              class="absolute top-0 left-0 block h-full"
              style={{
                width: "40%",
                background:
                  "linear-gradient(90deg, transparent, var(--color-solid-bright), transparent)",
              }}
              animate={{ x: ["-100%", "400%"] }}
              transition={{
                duration: 2.6,
                repeat: Number.POSITIVE_INFINITY,
                repeatDelay: 1.2,
                ease: "linear",
              }}
            />
          </Show>
        </span>
      </span>
    </>
  )
}
