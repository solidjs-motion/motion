import { bench, describe } from "vitest"
import { resolveVariant } from "../src/variants"

// What this measures
// ------------------
// `resolveVariant(name, variants, custom)` is on the hot path inside the
// state machine's `stateTargets` createMemo — every gesture flip and
// every variant cascade re-runs the resolver. The cost matters for:
//
//   - Lists rendered with `<For>` where each item resolves its variant
//     against an index-driven custom prop (dynamic variants).
//   - Parent cascades where children inherit a label and re-resolve on
//     each parent flip.
//
// Three shapes covered here: static Target, function variant with a
// custom prop, and array-of-labels merge.

describe("resolveVariant — static / dynamic / array", () => {
  const staticVariants = {
    visible: { opacity: 1, x: 0 },
    hidden: { opacity: 0, x: 100 },
    highlighted: { scale: 1.2, y: -4 },
  }

  bench("static variant lookup ('visible')", () => {
    resolveVariant("visible", staticVariants, undefined)
  })

  const dynamicVariants = {
    in: (custom: unknown) => {
      const i = custom as number
      return {
        opacity: 1,
        x: 0,
        transition: { delay: i * 0.05, duration: 0.3 },
      }
    },
    out: (custom: unknown) => {
      const i = custom as number
      return {
        opacity: 0,
        x: -16,
        transition: { delay: i * 0.05, duration: 0.2 },
      }
    },
  }

  bench("function variant with custom prop (i=5)", () => {
    resolveVariant("in", dynamicVariants, 5)
  })

  bench("array merge ['visible', 'highlighted']", () => {
    resolveVariant(["visible", "highlighted"], staticVariants, undefined)
  })

  bench("missing variant (returns null)", () => {
    resolveVariant("nonexistent", staticVariants, undefined)
  })
})
