# Reorder — primitive hook + component-pair wrappers

motion-react ships `<Reorder.Group>` / `<Reorder.Item>` as the canonical surface for drag-driven list reordering. The mechanics are entirely already-built layout primitives (`layout` FLIP for siblings, `drag` for the active item) plus one bit of glue: detecting when the dragged item's center crosses a sibling's center and firing a controlled-list reorder. We needed to decide whether to ship the same component pair, a Solid-native primitive hook, or both. The locked design ships both, but treats the primitive as the foundation and the components as a thin wrapper. This ADR records the load-bearing pieces of that surface and the implementation choices behind them.

**Decision:** A `createReorder` primitive owning the gesture + center-cross logic, plus `<Reorder.Group>` / `<Reorder.Item>` JSX wrappers that translate motion-react-style props into a primitive call. The dragged item's `layout` FLIP gates off via the existing `whileDrag` gesture-state flag (no new flag added). `onReorder` fires live per center-crossing during the drag — single source of truth, no preview state. Keyboard reorder is deferred to a follow-up `createReorderKeyboard` primitive; v1 is drag-only.

## Load-bearing details

- **Primitive + components, both shipped (decision C from the grill).** Every other public surface in the library is already shaped this way: `createMotion` underpins `useMotion` underpins `motion.X`. A `createReorder` hook keeps the pattern consistent, gives advanced users an escape hatch (custom JSX, custom container element, non-`<For>` iteration), and the component pair becomes a thin shim — a `<Dynamic>` for the tag, a `<LayoutGroup>` for layoutId scoping, a `splitProps` to peel the wrapper-specific props (`value`, `as`, `dragControls`), and a single `itemProps(value)` call. Users get the motion-react ergonomic; library authors building on top of Reorder get a Solid-idiomatic primitive.

- **`createReorder(values, setValues, options?)` takes an explicit `Accessor<T[]>` + `Setter<T[]>`.** No `T[] | Accessor<T[]>` overload. The primitive reads `values()` on every pointermove during a drag (to find the next sibling center to compare against), and re-installs `groupProps` / `itemProps` whenever the reactive options change. A static array would force the caller to re-invoke the primitive on every change, which doesn't match the primitive's lifetime model — it owns pointer subscriptions across mounts. Forcing `Accessor<T[]>` matches the `<LayoutGroup dependency>` "no static-value footgun" rule and keeps the read-on-demand path explicit. The component wrapper accepts whatever JSX-prop reactivity Solid users expect (`values={items()}` works because Solid's prop access IS reactive); under the hood it threads `() => props.values` into the primitive.

- **Identity is implicit reference equality in the primitive; the component wrapper takes an explicit `value` prop.** The primitive's `itemProps(value)` is called inside the user's `<For>` callback, where the `item` parameter IS the identity — same model `<For>` already uses. The component wrapper needs the `value` prop because the JSX `<Reorder.Item>` is otherwise disconnected from the array — there's no positional information to tie a node to a slot. The two surfaces converge: `<Reorder.Item value={item}>` is sugar for `<li {...itemProps(item)}>`. Duplicate values in the array produce undefined behavior; documented constraint, matching motion-react's implicit constraint via React's key warning.

- **`onReorder` fires live during the drag, per center-crossing.** Single source of truth — `values` IS what's rendered, what FLIPs animate to, what the user sees the dragged item passing. As the dragged item's projected center (its bcr center + drag offset) moves along the axis, on each pointermove the algorithm walks the siblings: for each whose center the dragged item has crossed since the last frame, swap in `values` and re-test (handles fast drags that cross multiple siblings in one tick). The alternatives — on-release-only, or live-visual-with-deferred-`onReorder` — both require a "preview vs committed" duality in the data model that doubles the surface for no real gain. motion-react does live; the parity is intentional.

- **Drag-suppressed layout: the dragged item's `layout` FLIP gates off via the existing `whileDrag` gesture-state flag.** Without suppression, every `onReorder` firing during a drag changes the dragged item's slot in the array, the parent-MO catches the childList change, the dragged item's controller measures a non-zero delta, and it FLIPs to its new slot — fighting the pointer-driven `drag` transform that should own the item's visual position. We added a single gate in `createLayoutController.runMeasurement`: if the element's gesture-state-machine reports `whileDrag === true`, skip the FLIP for THIS element (silently update `first` to the new layout position so when the drag ends and `whileDrag` flips off, the next measurement compares against the freshly-baselined slot). Sibling controllers are unaffected and FLIP normally. The choice not to add a new flag (e.g., `whileReordering`) keeps the gesture state machine's seven-flag shape unchanged and the gate works without Reorder having to know about the controller's internals.

- **Center-cross detection, no debounce.** When the dragged item's center along the axis passes a sibling's center, swap. The threshold IS the sibling's center; sub-pixel jitter doesn't trigger spurious swaps because the dragged item starts coincident with its own slot's center (delta from that origin needs to exceed half the next sibling's size to trigger). Edge-overlap detection would trigger on a 1-pixel nudge; threshold-based (e.g., 50%-overlap) introduces a magic number that varies per item size. Center-cross is what motion-react does and it's the most intuitively balanced rule — if A's center has crossed B's center, A has moved past B in the array.

- **Children are a user-provided `<For>`, not a render function.** `<Reorder.Group>` accepts `JSX.Element` children, not a `(item: T) => JSX.Element` callback. The user writes `<For each={items()}>{(item) => <Reorder.Item value={item}>...</Reorder.Item>}</For>` themselves. Solid convention. The killer feature: this lets users wrap the `<For>` in `<Presence>` so items entering/leaving the list get exit animations via the existing Presence machinery — no special-cased Reorder-Presence integration needed.

- **Container defaults: `<ul>` for Group, `<li>` for Item, both `as`-overridable.** Default semantic list. The non-list use case (draggable card grid, etc.) overrides via `as="div"` per element. Item defaults don't track Group's `as` — if a user picks `as="div"` for Group, they pick item tags themselves. This matches motion-react's behavior and keeps each prop locally explicit.

## Why a primitive + component pair, not just components

motion-react ships `<Reorder.Group>` / `<Reorder.Item>` only — no equivalent hook. We could have followed that and shipped just the component pair. Three reasons we didn't:

1. **Library consistency.** Every public surface here has the primitive-then-wrapper shape (`createMotion` / `useMotion` / `motion.X`). Adding Reorder as components-only would be the first surface that breaks the pattern.
2. **Custom-container use cases.** A user wanting to render their list inside a flex `<div>` with custom drag-region styling, or inside a virtualized container, or as a SortableJS-style hierarchy — none of these compose cleanly with `<Reorder.Group>`'s opinionated render. The primitive's `groupProps` lets them spread onto whatever element they want.
3. **The components are essentially free given the primitive.** A `<Reorder.Group>` is ~20 lines: `splitProps`, a `<Dynamic>` for the tag, `<LayoutGroup>`, spread `groupProps`, render children. Shipping both costs almost nothing once `createReorder` exists. Skipping the primitive would mean re-implementing the logic if someone ever wants the lower-level surface.

The component pair stays — it's the discoverable surface for users coming from motion-react, and it's the right default for the 95% case of "ul of li items."

## Why not keyboard a11y in v1

Drag-only ships first. Keyboard reorder (Space-to-grab, arrow-keys-to-move, Escape-to-cancel) lands later as a separate `createReorderKeyboard` primitive. The choice isn't permanent; it's about not designing two features in parallel under a single grill session.

Keyboard reorder needs decisions that are independent of the drag mechanics:
- Focus management (roving tabindex vs no focus management, what happens when the focused item is moved out of view).
- `aria-live` announcer strings (grab/move/drop announcements; localization).
- Grab-state visual indicator (separate from the drag visual? same? what styles?).
- Cancel semantics (revert to pre-grab order, or just stop?).
- Composition with the drag handle (does pressing Space on the handle grab the parent?).

Each of these is its own subtree of design space; bundling them into the same release would force decisions before real keyboard usage informs them. Shipping the drag-only primitive first means the keyboard layer, when it lands, is informed by users actually building reorderable lists with `createReorder`. The keyboard primitive will be purely additive (it just calls `setValues` with a programmatically computed reorder) and won't change `createReorder`'s signature.

## Tradeoffs

- **`onReorder` fires rapidly during a drag.** A user-controlled list of 100 items being dragged across all of them fires `setValues` ~100 times in ~3 seconds. Solid's signal-update path is cheap, but downstream effects (e.g., a `createEffect` that serializes the list to localStorage) will see every intermediate state. Users with expensive setters should batch or debounce themselves. Documented; matches motion-react's behavior with a comparable React-state churn.

- **The `whileDrag` gate is a shared concept between Reorder and the gesture state machine.** Future changes to either system have to remember the gate exists. The gate is a SINGLE check at the top of `runMeasurement` — minimal coupling, but a coupling nonetheless. The alternative (a dedicated `_reorderActive` flag, or surfacing the suppression via Reorder's own context) would isolate Reorder but pay a new piece of state for a check that's logically identical to what `whileDrag` already represents.

- **Duplicate values produce undefined behavior.** `<For>` with duplicate keys is itself undefined; Reorder inherits this. Documented constraint with a note in the JSDoc. The alternative (assigning auto-generated `Symbol`-based keys per Reorder.Item mount) would handle duplicates but break the "value-as-identity" intuition AND fail to round-trip if the same array is re-rendered (Symbols are mount-scoped). Matching `<For>`'s rule is correct.

- **No keyboard a11y in v1 is a real gap.** Drag-only reorder isn't accessible to keyboard-only users or screen-reader users. The known-gap stance is honest but the documentation has to call it out prominently. We'll add a "keyboard support is not yet implemented" callout in the public JSDoc and the README example.

- **Multi-crossing-per-frame is correct but allocates.** A drag that crosses 10 siblings in one frame fires 10 `setValues` calls, each of which produces a new array via `splice` or equivalent. Allocations are bounded and short-lived; profile if it becomes an issue.

## Reversibility

Medium. The public surface — `createReorder`, `<Reorder.Group>`, `<Reorder.Item>` — is hard to change without a major version bump once people use it. Internally the gate-via-`whileDrag` is reversible (could switch to a dedicated flag without changing public types). The center-cross detection algorithm is reversible (could switch to threshold-based without changing public types, though the visual behavior would shift in ways users might notice).

The most load-bearing irreversible choice is the **live-during-drag `onReorder` firing.** Switching to on-release would change every user's data model — they'd have to handle "the visual order isn't the data order" — and would silently break code that derives state from `values` mid-drag (e.g., computed-property reactivity). If we ever wanted to add an on-release mode it'd have to be opt-in (`commitMode: "live" | "release"`) and the default stays "live."
