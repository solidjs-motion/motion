// ---------------------------------------------------------------------------
// Demo registry — single source of truth for the router and the nav. Each
// entry pairs a route path with a title, a short blurb, a lazy import, and
// a lazy source loader (Vite's `?raw` query returns the file contents as a
// string at runtime). Adding a demo: write the component under src/demos/,
// register it here. The route is wired automatically in main.tsx by mapping
// over this list; the source loader is consumed by <DemoSource> in the shell.
// ---------------------------------------------------------------------------

import { lazy } from "solid-js"

export type DemoEntry = {
  /** Route path (no leading slash beyond the root `/`). */
  path: string
  /** Sidebar label. */
  title: string
  /** One-line description shown under the title in the demo header. */
  blurb: string
  /** Phase tag — drives sidebar grouping. */
  phase: 1 | 2
  /** Lazy-loaded page component. */
  component: ReturnType<typeof lazy>
  /**
   * Lazy source loader. Returns the raw .tsx text. Wired through Vite's
   * `?raw` query — the source is only fetched when DemoSource expands.
   */
  source: () => Promise<string>
  /** File name shown in the source-block header. */
  filename: string
}

/** Helper: build a source-loader from a `?raw` dynamic import. */
function rawSource(loader: () => Promise<{ default: string }>): () => Promise<string> {
  return () => loader().then((m) => m.default)
}

export const demos: DemoEntry[] = [
  // ---- Phase 1 ----
  {
    path: "/fade-in",
    title: "FadeIn",
    blurb: "Mount-time fade + slide via static useMotion options.",
    phase: 1,
    component: lazy(() => import("./FadeIn")),
    source: rawSource(() => import("./FadeIn.tsx?raw")),
    filename: "FadeIn.tsx",
  },
  {
    path: "/toggle",
    title: "Toggle (variants)",
    blurb: "Signal-driven variant swap with a spring transition.",
    phase: 1,
    component: lazy(() => import("./Toggle")),
    source: rawSource(() => import("./Toggle.tsx?raw")),
    filename: "Toggle.tsx",
  },
  {
    path: "/signal-driven-size",
    title: "MotionValue size",
    blurb: "MotionValue piped directly into a useMotion target.",
    phase: 1,
    component: lazy(() => import("./SignalDrivenSize")),
    source: rawSource(() => import("./SignalDrivenSize.tsx?raw")),
    filename: "SignalDrivenSize.tsx",
  },
  {
    path: "/scroll-linked",
    title: "Scroll-linked bar",
    blurb: "createScroll → createTransform → MotionValue-driven width.",
    phase: 1,
    component: lazy(() => import("./ScrollLinked")),
    source: rawSource(() => import("./ScrollLinked.tsx?raw")),
    filename: "ScrollLinked.tsx",
  },
  {
    path: "/reduced-motion",
    title: "Reduced motion",
    blurb: "System-pref accessor via createReducedMotion.",
    phase: 1,
    component: lazy(() => import("./ReducedMotion")),
    source: rawSource(() => import("./ReducedMotion.tsx?raw")),
    filename: "ReducedMotion.tsx",
  },
  // ---- Phase 2 ----
  {
    path: "/gestures",
    title: "Gesture composition",
    blurb: "hover / press / focus stacked on one element (state-machine winners).",
    phase: 2,
    component: lazy(() => import("./GestureComposition")),
    source: rawSource(() => import("./GestureComposition.tsx?raw")),
    filename: "GestureComposition.tsx",
  },
  {
    path: "/in-view-provider",
    title: "whileInView + Provider",
    blurb: "Card fades in on viewport entry; nested child inherits via m.Provider.",
    phase: 2,
    component: lazy(() => import("./InViewAndProvider")),
    source: rawSource(() => import("./InViewAndProvider.tsx?raw")),
    filename: "InViewAndProvider.tsx",
  },
  {
    path: "/drag",
    title: "Drag",
    blurb: "useMotion drag with constraints, elastic resistance, momentum.",
    phase: 2,
    component: lazy(() => import("./Drag")),
    source: rawSource(() => import("./Drag.tsx?raw")),
    filename: "Drag.tsx",
  },
  {
    path: "/drag-controls",
    title: "Drag controls",
    blurb: "Handle button drives drag on a separate target via createDragControls.",
    phase: 2,
    component: lazy(() => import("./DragControls")),
    source: rawSource(() => import("./DragControls.tsx?raw")),
    filename: "DragControls.tsx",
  },
  {
    path: "/pan",
    title: "Standalone pan",
    blurb: "createPan with pan.point.x piped through createTransform.",
    phase: 2,
    component: lazy(() => import("./Pan")),
    source: rawSource(() => import("./Pan.tsx?raw")),
    filename: "Pan.tsx",
  },
  {
    path: "/in-view",
    title: "createInView (snapshot)",
    blurb: "Single-threshold observer — entry snapshots at enter/leave.",
    phase: 2,
    component: lazy(() => import("./InView")),
    source: rawSource(() => import("./InView.tsx?raw")),
    filename: "InView.tsx",
  },
  {
    path: "/in-view-live",
    title: "createInView (live ratio)",
    blurb: "Multi-threshold array — continuous intersectionRatio updates during scroll.",
    phase: 2,
    component: lazy(() => import("./InViewLiveRatio")),
    source: rawSource(() => import("./InViewLiveRatio.tsx?raw")),
    filename: "InViewLiveRatio.tsx",
  },
  // ---- Patterns (cross-cutting examples) ----
  {
    path: "/variant-orchestration",
    title: "Variant orchestration",
    blurb: "Parent label cascades; staggered children via `custom` + dynamic variants.",
    phase: 2,
    component: lazy(() => import("./VariantOrchestration")),
    source: rawSource(() => import("./VariantOrchestration.tsx?raw")),
    filename: "VariantOrchestration.tsx",
  },
  {
    path: "/controlling-children",
    title: "Controlling vs passive",
    blurb: "Children with their own variant label opt out of the parent cascade.",
    phase: 2,
    component: lazy(() => import("./ControllingChild")),
    source: rawSource(() => import("./ControllingChild.tsx?raw")),
    filename: "ControllingChild.tsx",
  },
  {
    path: "/motion-config",
    title: "MotionConfig",
    blurb: "Share transition defaults across a subtree via <MotionConfig>.",
    phase: 2,
    component: lazy(() => import("./MotionConfigDemo")),
    source: rawSource(() => import("./MotionConfigDemo.tsx?raw")),
    filename: "MotionConfigDemo.tsx",
  },
  {
    path: "/spring",
    title: "createSpring",
    blurb: "Spring-smoothed mirror of a numeric input — cursor follower with physics lag.",
    phase: 2,
    component: lazy(() => import("./CreateSpringDemo")),
    source: rawSource(() => import("./CreateSpringDemo.tsx?raw")),
    filename: "CreateSpringDemo.tsx",
  },
  {
    path: "/template",
    title: "createTemplate",
    blurb: "Tagged template composing a transform string from multiple MotionValues.",
    phase: 2,
    component: lazy(() => import("./CreateTemplateDemo")),
    source: rawSource(() => import("./CreateTemplateDemo.tsx?raw")),
    filename: "CreateTemplateDemo.tsx",
  },
  {
    path: "/velocity-time",
    title: "createVelocity / createTime",
    blurb: "Frame-driver + velocity reader — oscillator that tilts in its direction of motion.",
    phase: 2,
    component: lazy(() => import("./CreateVelocityTime")),
    source: rawSource(() => import("./CreateVelocityTime.tsx?raw")),
    filename: "CreateVelocityTime.tsx",
  },
]
