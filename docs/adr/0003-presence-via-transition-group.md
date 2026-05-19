# Presence via @solid-primitives/transition-group with an inverted PresenceContext

Phase 3 needs exit animations — a motion child must finish a configurable `exit` target before the surrounding `<Show>` / `<For>` lets Solid actually dispose it. Two existing playbooks were on the table:

1. **solid-motionone's pattern.** Use motion-dom's `mountedStates` registry + a DOM-level `"motioncomplete"` event. `<Presence>` wraps `createSwitchTransition(resolveFirst(() => props.children), { onExit(el, done) { el.addEventListener("motioncomplete", done); ... } })`. Exit dispatch is implicit — flipping the `exit` flag on the mounted state schedules the animation, and motion-dom emits `motioncomplete` when it settles.
2. **Build our own.** Child registers a `runExit: () => Promise<void>` callable through context; Presence dispatches via `beforeUnmount(el)`. Coordination uses `@solid-primitives/transition-group` for the keep-alive-until-done semantics but stops there.

**Decision:** Option 2. The `PresenceContextValue` is **inverted** relative to motion-react's shape:

```ts
type PresenceContextValue = {
  register: (el: MotionElement, runExit: () => Promise<void>) => void
  unregister: (el: MotionElement) => void
  beforeUnmount: (el: MotionElement) => Promise<void>
  initial?: Accessor<boolean>
}
```

The child knows how to animate itself out; Presence only coordinates timing. The implementation has three load-bearing details:

- **`runExit` snapshots its config at construction.** It captures `exit` / `variants` / `custom` / `transition` from `initialOpts` (and a `parentVariantCtx.exit` accessor for the inherited label case), then dispatches motion's `animate(el, target, transition)` directly. Reactive changes to those options mid-life are intentionally NOT picked up at exit time. The alternative — keeping the gesture state machine alive across owner disposal — fights Solid's lifecycle, and the "user reactively swaps exit after mount" case is rare enough that snapshot semantics are the right default.
- **Unregister is Presence's responsibility, after exit settles.** `createMotion` deliberately omits `onCleanup(() => presence.unregister(el))`. Solid disposes the child's owner synchronously when `<Show>`/`<For>` flips, well before transition-group's `onExit` callback runs; a child-side cleanup would empty the registry before Presence could dispatch. Presence's `onExit` (switch) and `onChange.removed` (list) handlers call `beforeUnmount(el).then(() => unregister(el); done())` after the runExit promise resolves.
- **A `PresenceCore` subcomponent owns the transition-group setup.** Inlining `resolveElements(() => props.children)` directly inside `<Provider>`'s JSX children — either as a bare expression or as an IIFE — re-enters the children getter when downstream code reads `props.children` again, double-mounting every motion descendant. Wrapping the resolution in a real Solid component breaks the cycle because Solid memoizes component instantiation. solid-motionone gets away with inline `resolveFirst` because their list path doesn't exist and their switch source has only one reader; we need both paths reading from the same memo, which makes the subcomponent boundary load-bearing.

Single-vs-list dispatch is decided at the first `resolved()` read and stable for the Presence instance's lifetime. Neither `createSwitchTransition` nor `createListTransition` supports being torn down and rebuilt mid-life; callers who genuinely need to flip between single and list shapes can re-key with a wrapping `<Show>`.

**Why not the `motioncomplete`-DOM-event pattern.** Three reasons:

1. **State-machine ownership.** Our diff-and-animate effect (ADR 0002) owns target resolution, priority winners, and reduced-motion handling for every other gesture. Hooking exit through a motion-dom-side mountedState would split that logic — exit would resolve targets via motion-dom's path while hover/press/animate resolved via ours, and the two would have to stay in sync. The inverted-context design lets the SAME `resolveTarget` + `mergeTransition` helpers handle exit, just dispatched from a snapshot.
2. **No VisualElement assumption.** `mountedStates` is HTML-only (motion-dom's `HTMLVisualElement` is HTML-specific; SVG support is a stub). Our `MotionElement = HTMLElement | SVGElement` widening (commit `5c36813`) means Phase 4's `<motion.svg>` works through the same Presence path. The DOM-event pattern would force us to special-case SVG.
3. **Hook surface.** `useAnimatePresence()` ships alongside `<Presence>` as a library-author escape hatch — same context shape, different orchestrator. The motioncomplete pattern doesn't have a clean way to expose this as an imperative API; the inverted-context shape makes the hook a thin wrapper that snapshots the registry and `Promise.all`s every registered runExit.

**Tradeoffs.**

- Slightly more code (~290 LoC for `presence.tsx`) than the solid-motionone pattern (~50 LoC) would have been. The extra surface buys us the list path, the hook variant, SVG support, and target-resolution unification.
- Snapshot semantics for exit config. Reactive `exit` changes after mount are silently lost. Documented inline; revisitable in v0.2 if a real consumer asks.
- The `flush()` helper in tests needs more microtask awaits (six) than feels obvious. The chain is `controls.then → unregister .then → Promise.all → finishRemoved → memo re-eval → DOM update`. Each `.then` defers one microtask. Tests document the count rather than working around it.

**Reversibility.** High. The public surface (`<Presence>`, `useAnimatePresence`, `PresenceProps`, hook return type) is unchanged from what motion-react users expect; if the inverted-context design hits friction, we can swap the internals for the motioncomplete-DOM-event pattern without breaking callers. The biggest risk is the subcomponent boundary: removing `PresenceCore` re-introduces the double-mount bug, so future refactors should keep some real component between the Provider and the resolution memo.
