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
  registerEnter?: (el: MotionElement, runEnter: () => void) => void
  beforeMount?: (el: MotionElement) => void
  initial?: Accessor<boolean>
}
```

The child knows how to animate itself out; Presence only coordinates timing. The implementation has five load-bearing details:

- **`runExit` re-reads opts at exit time** (via `untrack(getOpts)`). The closure captures only the `el` and the state-machine handles; everything else — `exit`, `variants`, `custom`, `transition` — is read live when Presence actually calls the callable. This lets reactive `exit` targets work: a swipe-card whose exit direction depends on which way the user just flicked sees the LATEST direction, not the value that happened to be live when the card mounted. Safe because Solid's props proxy is a plain JS object the closure keeps referenced, so it survives owner disposal; only signal subscriptions would have been torn down, which is why we wrap in `untrack`.
- **Unregister is Presence's responsibility, after exit settles.** `createMotion` deliberately omits `onCleanup(() => presence.unregister(el))`. Solid disposes the child's owner synchronously when `<Show>`/`<For>` flips, well before transition-group's `onExit` callback runs; a child-side cleanup would empty the registry before Presence could dispatch. Presence's `onExit` (switch) and `onChange.removed` (list) handlers call `beforeUnmount(el).then(() => unregister(el); done())` after the runExit promise resolves.
- **Enter is symmetric: `registerEnter` / `beforeMount` defer the first-mount animate until the element is connected.** When the new child of a `<Presence mode="wait">` swap is created, transition-group keeps it OFF-DOM until the previous child's exit settles. If the state machine's first iteration dispatched motion's `animate()` then — eagerly, as it does outside a Presence — the WAA animation would run to completion on a disconnected element and the terminal `commitStyles` would silently no-op. The child would paint at its `initial` target when it finally enters the DOM. So when `createMotion` detects it's inside a real Presence (`presence.registerEnter` is defined), it registers a `runEnter` callable, gates the state machine's first iteration on an `enterReady` signal, and lets Presence flip readiness from `onEnter` (switch) / `onChange.added` (list) — both of which fire AFTER `setReturned` has synchronously inserted the node into the DOM. A microtask fallback in createMotion flips readiness when the element is already connected (the initial child of a `<Presence initial={false}>` that never goes through a transition-group enter callback).
- **`pointer-events: none` on exiting elements.** In sync mode (the default), transition-group keeps the old node in the DOM as a sibling of the new one with the old LATER in source order — putting the exiting node ON TOP in z-stacking. Even at opacity:0 mid-exit, that node intercepts pointer events intended for the incoming card. Presence sets `pointer-events: none` on every exiting element the moment it sees the exit start, so drag / hover / click on the new card work immediately rather than after the exit settles.
- **A `PresenceCore` subcomponent owns the transition-group setup.** Inlining `resolveElements(() => props.children)` directly inside `<Provider>`'s JSX children — either as a bare expression or as an IIFE — re-enters the children getter when downstream code reads `props.children` again, double-mounting every motion descendant. Wrapping the resolution in a real Solid component breaks the cycle because Solid memoizes component instantiation. solid-motionone gets away with inline `resolveFirst` because their list path doesn't exist and their switch source has only one reader; we need both paths reading from the same memo, which makes the subcomponent boundary load-bearing.

`useMotion` also reads `presence.initial` at construction: when an enclosing `<Presence initial={false}>` propagates suppression, `computeInitialStyle` returns the style for the **animate** target rather than the initial target, so the child paints at its final state without an enter animation (`suppressFirstMount` already skips the state machine's first dispatch separately).

Single-vs-list dispatch is decided at the first `resolved()` read and stable for the Presence instance's lifetime. Neither `createSwitchTransition` nor `createListTransition` supports being torn down and rebuilt mid-life; callers who genuinely need to flip between single and list shapes can re-key with a wrapping `<Show>`.

**Why not the `motioncomplete`-DOM-event pattern.** Three reasons:

1. **State-machine ownership.** Our diff-and-animate effect (ADR 0002) owns target resolution, priority winners, and reduced-motion handling for every other gesture. Hooking exit through a motion-dom-side mountedState would split that logic — exit would resolve targets via motion-dom's path while hover/press/animate resolved via ours, and the two would have to stay in sync. The inverted-context design lets the SAME `resolveTarget` + `mergeTransition` helpers handle exit, just dispatched from a snapshot.
2. **No VisualElement assumption.** `mountedStates` is HTML-only (motion-dom's `HTMLVisualElement` is HTML-specific; SVG support is a stub). Our `MotionElement = HTMLElement | SVGElement` widening (commit `5c36813`) means Phase 4's `<motion.svg>` works through the same Presence path. The DOM-event pattern would force us to special-case SVG.
3. **Hook surface.** `useAnimatePresence()` ships alongside `<Presence>` as a library-author escape hatch — same context shape, different orchestrator. The motioncomplete pattern doesn't have a clean way to expose this as an imperative API; the inverted-context shape makes the hook a thin wrapper that snapshots the registry and `Promise.all`s every registered runExit.

**Tradeoffs.**

- Slightly more code (~290 LoC for `presence.tsx`) than the solid-motionone pattern (~50 LoC) would have been. The extra surface buys us the list path, the hook variant, SVG support, target-resolution unification, the `pointer-events` swap fix, and the live-read of exit opts.
- Reading `props.X` from a disposed-owner closure is unusual. We rely on the fact that Solid's props proxy is a plain JS object kept alive by the runExit closure and that `untrack` short-circuits any signal subscription that would otherwise try to register on a torn-down owner. If a future Solid release changes this — e.g., props are reactive proxies that throw when their owner is dead — the live-read would have to fall back to a snapshot.
- The `flush()` helper in tests needs more microtask awaits (six) than feels obvious. The chain is `controls.then → unregister .then → Promise.all → finishRemoved → memo re-eval → DOM update`. Each `.then` defers one microtask. Tests document the count rather than working around it.

**Reversibility.** High. The public surface (`<Presence>`, `useAnimatePresence`, `PresenceProps`, hook return type) is unchanged from what motion-react users expect; if the inverted-context design hits friction, we can swap the internals for the motioncomplete-DOM-event pattern without breaking callers. The biggest risk is the subcomponent boundary: removing `PresenceCore` re-introduces the double-mount bug, so future refactors should keep some real component between the Provider and the resolution memo.
