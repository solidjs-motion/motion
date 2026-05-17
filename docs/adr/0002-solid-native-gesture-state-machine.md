# Solid-native fine-grained gesture state machine

motion-dom exposes `createAnimationState` — a 386-line imperative state machine that handles priority resolution across `animate`/`whileHover`/`whileTap`/`whileDrag`/`whileFocus`/`whileInView`/`exit`, per-key handoff when a higher-priority state deactivates ("removed keys" walking down to lower-priority defining states), and parent-child variant inheritance via a `variantChildren: Set<VisualElement>` walk. Adopting it would give exact motion/react parity.

**Decision:** Build a Solid-native fine-grained state machine in `createMotion.ts` using Solid primitives. Shape:

- `createStore` for the seven active flags (animate, whileInView, whileHover, whilePress, whileFocus, whileDrag, exit).
- `createMemo` for per-state resolved targets (reads opts + parent variant context).
- `createMemo` for per-key winners — walks active states high → low priority; each key claimed by the first defining state.
- `createEffect` that diffs the winners object against the last applied snapshot; animates changed keys and animates removed keys back to their fallback value (own initial → motion default → `null` for computed-style read).

Gesture handlers (hover/press/focus/inView/pan/drag) only flip the active flags via `setActive("whileX", boolean)`. The diff effect is the single animate-triggering site.

**Why not `createAnimationState`.** Three reasons:

1. **Push-model vs reactive.** `createAnimationState` reads everything from `visualElement.props` synchronously on each `animateChanges()` call. Bridging Solid reactivity to it means writing a `createEffect` whose body is "sync my Solid options into `ve.props`, then call `animateChanges()`" — a shim layer at every reactive boundary.
2. **Two inheritance trees.** `createAnimationState`'s parent-child variant cascade uses `variantChildren` on each VisualElement; our existing `VariantContext` (Phase 1) uses Solid's owner tree. Adopting motion's machine means maintaining both trees in sync, or abandoning the Solid context entirely.
3. **Untyped surface.** `createAnimationState` isn't in motion-dom's public `.d.ts` exports. We'd cast or declare types ourselves, with no guarantee of stability across motion-dom releases.

**Tradeoff.** ~150 LoC we own and refactor vs ~30 LoC bridge that couples to untyped motion-dom internals and forces an imperative sync layer that fights Solid's reactive grain. We forfeit some edge-case motion behavior (the `removedKeys`-walking-to-lower-priority-defining-state subtlety; the strict-mode `wasReset` resilience). The per-key handoff we DO implement (own initial → motion default → null) covers the common cases users will hit.

**Reversibility.** Moderate. The state machine is load-bearing for Phase 2's gesture flow, but the surface contract (`setActive(type, boolean)` plus the diff-and-animate effect) is small. v0.2 can revisit if a real consumer hits a parity gap that justifies the heavier integration.
