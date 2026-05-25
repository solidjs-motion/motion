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
  phase: 1 | 2 | 3 | 4
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
  // ---- Phase 3 ----
  {
    path: "/presence-fade",
    title: "Presence (fade)",
    blurb: "Single-element exit — <Show> + <Presence> running an exit target before unmount.",
    phase: 3,
    component: lazy(() => import("./PresenceFade")),
    source: rawSource(() => import("./PresenceFade.tsx?raw")),
    filename: "PresenceFade.tsx",
  },
  {
    path: "/presence-list",
    title: "Presence (list)",
    blurb:
      "<For> + add/remove with per-item enter/exit. Removed items animate; survivors stay put.",
    phase: 3,
    component: lazy(() => import("./PresenceList")),
    source: rawSource(() => import("./PresenceList.tsx?raw")),
    filename: "PresenceList.tsx",
  },
  {
    path: "/presence-stagger",
    title: "Presence (staggered list)",
    blurb: "Per-item enter/exit with custom-driven delays — dynamic variants over the list.",
    phase: 3,
    component: lazy(() => import("./PresenceListStagger")),
    source: rawSource(() => import("./PresenceListStagger.tsx?raw")),
    filename: "PresenceListStagger.tsx",
  },
  {
    path: "/presence-orchestrated",
    title: "Presence (orchestrated)",
    blurb:
      "Parent shell's variant label cascades through m.Provider; Presence's descendant-walk exit makes the cascade work at unmount too.",
    phase: 3,
    component: lazy(() => import("./PresenceOrchestratedList")),
    source: rawSource(() => import("./PresenceOrchestratedList.tsx?raw")),
    filename: "PresenceOrchestratedList.tsx",
  },
  {
    path: "/presence-wait",
    title: 'Presence mode="wait"',
    blurb: "Sequential panel swap — old exits fully before new enters.",
    phase: 3,
    component: lazy(() => import("./PresenceWaitMode")),
    source: rawSource(() => import("./PresenceWaitMode.tsx?raw")),
    filename: "PresenceWaitMode.tsx",
  },
  {
    path: "/presence-initial-false",
    title: "Presence initial={false}",
    blurb: "First-mount suppression. Initial paint is static; subsequent mounts animate.",
    phase: 3,
    component: lazy(() => import("./PresenceInitialFalse")),
    source: rawSource(() => import("./PresenceInitialFalse.tsx?raw")),
    filename: "PresenceInitialFalse.tsx",
  },
  {
    path: "/use-animate-presence",
    title: "useAnimatePresence (hook)",
    blurb: "Imperative escape hatch — exit() returns a Promise, await it before flipping mount.",
    phase: 3,
    component: lazy(() => import("./UseAnimatePresenceHook")),
    source: rawSource(() => import("./UseAnimatePresenceHook.tsx?raw")),
    filename: "UseAnimatePresenceHook.tsx",
  },
  {
    path: "/presence-gestures",
    title: "Presence + gestures",
    blurb: "Hover/press combined with exit on the same card — gesture priority unchanged.",
    phase: 3,
    component: lazy(() => import("./PresenceWithGestures")),
    source: rawSource(() => import("./PresenceWithGestures.tsx?raw")),
    filename: "PresenceWithGestures.tsx",
  },
  {
    path: "/presence-drag",
    title: "Presence + drag",
    blurb: "Drag the card, then remove it — exit's x overrides drag's claim mid-unmount.",
    phase: 3,
    component: lazy(() => import("./PresenceWithDrag")),
    source: rawSource(() => import("./PresenceWithDrag.tsx?raw")),
    filename: "PresenceWithDrag.tsx",
  },
  {
    path: "/presence-toasts",
    title: "Presence (toast queue)",
    blurb: "Stacked notifications — fire/auto-dismiss/clear all with parallel-exit coordination.",
    phase: 3,
    component: lazy(() => import("./PresenceToastQueue")),
    source: rawSource(() => import("./PresenceToastQueue.tsx?raw")),
    filename: "PresenceToastQueue.tsx",
  },
  {
    path: "/presence-modal",
    title: "Presence (modal + backdrop)",
    blurb: "Two children in one Presence — backdrop + dialog exit in parallel.",
    phase: 3,
    component: lazy(() => import("./PresenceModalDialog")),
    source: rawSource(() => import("./PresenceModalDialog.tsx?raw")),
    filename: "PresenceModalDialog.tsx",
  },
  {
    path: "/presence-stack",
    title: "Presence (swipe stack)",
    blurb: "Tinder-style draggable cards — exit direction follows the swipe, next card promotes.",
    phase: 3,
    component: lazy(() => import("./PresenceImageStack")),
    source: rawSource(() => import("./PresenceImageStack.tsx?raw")),
    filename: "PresenceImageStack.tsx",
  },
  // ---- Phase 4 ----
  {
    path: "/motion-proxy-tag",
    title: "motion.X tag-component",
    blurb:
      "Orchestrated stagger via <motion.ul> + passive <motion.li> children — no useMotion calls, no manual m.Provider.",
    phase: 4,
    component: lazy(() => import("./MotionProxyTag")),
    source: rawSource(() => import("./MotionProxyTag.tsx?raw")),
    filename: "MotionProxyTag.tsx",
  },
  {
    path: "/motion-proxy-create",
    title: "motion.create (HOC)",
    blurb:
      "Wrap a custom Component with motion — original props compose with the full MotionOptions surface.",
    phase: 4,
    component: lazy(() => import("./MotionProxyCreate")),
    source: rawSource(() => import("./MotionProxyCreate.tsx?raw")),
    filename: "MotionProxyCreate.tsx",
  },
  {
    path: "/sierpinski",
    title: "Sierpinski (perf stress)",
    blurb:
      "6,500+ motion.divs subscribing to one shared MotionValue via style — the canonical fan-out stress test, with live FPS counter and depth slider.",
    phase: 4,
    component: lazy(() => import("./SierpinskiTriangle")),
    source: rawSource(() => import("./SierpinskiTriangle.tsx?raw")),
    filename: "SierpinskiTriangle.tsx",
  },
  // ---- Layout animations (0.2.0) ----
  {
    path: "/layout-toggle",
    title: "Layout (toggle)",
    blurb:
      "Single motion.div whose width/height swaps via signal — `layout` FLIPs from the old rect to the new one via ResizeObserver(self).",
    phase: 4,
    component: lazy(() => import("./LayoutToggle")),
    source: rawSource(() => import("./LayoutToggle.tsx?raw")),
    filename: "LayoutToggle.tsx",
  },
  {
    path: "/layout-list",
    title: "Layout (list)",
    blurb:
      "<For> list with add / remove / shuffle. Survivors animate to new slots via parent-MutationObserver triggers; inserted items baseline.",
    phase: 4,
    component: lazy(() => import("./LayoutList")),
    source: rawSource(() => import("./LayoutList.tsx?raw")),
    filename: "LayoutList.tsx",
  },
  {
    path: "/layout-id-handoff",
    title: "Shared element (layoutId)",
    blurb:
      "Thumbnail ↔ hero share `layoutId='card'`. Donor's onCleanup donates rect; consumer's createMotion FLIPs from there. Wrapped in Presence — exit + FLIP run in parallel.",
    phase: 4,
    component: lazy(() => import("./LayoutIdHandoff")),
    source: rawSource(() => import("./LayoutIdHandoff.tsx?raw")),
    filename: "LayoutIdHandoff.tsx",
  },
  {
    path: "/layout-group-namespace",
    title: "LayoutGroup scoping",
    blurb:
      "Two tab strips, each with its own <LayoutGroup>. Same layoutId in each doesn't cross-match — the indicator stays put when the other strip's tab changes.",
    phase: 4,
    component: lazy(() => import("./LayoutGroupNamespace")),
    source: rawSource(() => import("./LayoutGroupNamespace.tsx?raw")),
    filename: "LayoutGroupNamespace.tsx",
  },
  // ---- Reorder (0.2.0) ----
  {
    path: "/reorder-basic",
    title: "Reorder (basic)",
    blurb:
      "<Reorder.Group> + <Reorder.Item> — drag any row to reorder a controlled list. Center-cross detection mutates values() live; siblings FLIP into new slots; dragged row snaps back via dragSnapToOrigin.",
    phase: 4,
    component: lazy(() => import("./ReorderBasic")),
    source: rawSource(() => import("./ReorderBasic.tsx?raw")),
    filename: "ReorderBasic.tsx",
  },
  {
    path: "/reorder-handle",
    title: "Reorder (handle)",
    blurb:
      "Drag-handle pattern. Each row has a `⋮⋮` grip; the rest of the row (checkbox, remove button) stays independently interactive. `dragListener: false` + `dragControls` scopes drag initiation to the handle.",
    phase: 4,
    component: lazy(() => import("./ReorderHandle")),
    source: rawSource(() => import("./ReorderHandle.tsx?raw")),
    filename: "ReorderHandle.tsx",
  },
  {
    path: "/reorder-with-exit",
    title: "Reorder (with exit)",
    blurb:
      "Reorder + <Presence>-coordinated exit. Add / remove items at will — removed items fade + scale out via `exit`; survivors FLIP into new slots in parallel. The <For> sits inside <Presence> so drag-reorder + add/remove all route through the keep-alive coordinator.",
    phase: 4,
    component: lazy(() => import("./ReorderWithExit")),
    source: rawSource(() => import("./ReorderWithExit.tsx?raw")),
    filename: "ReorderWithExit.tsx",
  },
]
