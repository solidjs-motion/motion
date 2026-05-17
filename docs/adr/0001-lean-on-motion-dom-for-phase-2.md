# Lean on motion-dom for Phase 2 gesture and drag mechanics

Phase 1 documented a rule: "Don't import from `motion/react` or undocumented `motion/dom` paths — public surface only from `motion`." Phase 2 needs `hover`, `press`, drag with transform composition, focus/inView/pan plumbing. The `motion` umbrella package exposes none of these (its `.d.ts` re-exports only `animate`/`inView`/`scroll`/`spring` etc.); vanilla `drag`/`pan` don't exist outside motion's React layer. The standalone `motion-dom` npm package exposes `hover` and `press` typed and a `VisualElement` system that handles transform composition for drag + concurrent transform animations.

**Decision:** Phase 2 imports directly from `motion-dom`:

- `hover`, `press` — gesture primitives (Q1, Q13)
- `visualElementStore`, `createDOMVisualElement` — VisualElement access for drag's x/y MotionValues (Q5 C-lean)
- `addDomEvent` — focus/blur listener helper (Q12)
- `frame`, `cancelFrame`, `time`, `isPrimaryPointer`, `distance2D` — pointer-session bookkeeping (Q11 D3)
- `setDragLock`, `isDragActive` — nested-drag correctness (Q6a)
- `variantPriorityOrder`, `animateVisualElement`, `getValueTransition` — strategic primitives (Q6a)
- `stagger` re-exported from `motion` (Q6a)

This reverses the Phase 1 "no motion-dom paths" rule. Some exports above lack public `.d.ts` types (e.g., `visualElementStore`, `createDOMVisualElement` are runtime-stable but not typed in motion-dom's exported declarations); we cast where needed.

**Considered alternatives.** Building hover/press/drag composition from scratch — rejected as ~1000 LoC of work duplicating well-tested motion-dom code and forfeiting WAAPI-aware transform composition. Importing `hover`/`press` runtime-only from `motion` (they exist at runtime, untyped) — rejected because `visualElementStore` and the VisualElement APIs aren't on `motion`'s runtime exports either; if we depend on motion-dom for those, we may as well do so consistently.

**Consequences.**

- `motion-dom` becomes a peer dependency alongside `motion`. Users must install both with matching versions (motion@X requires motion-dom@X exactly).
- Future motion-dom releases may change internal APIs (`visualElementStore` shape, VisualElement methods). We pin compatibility ranges carefully.
- `whileDrag: { scale: 1.05 }` works (composes via motion-dom's VisualElement) — a motion/react idiom we'd have had to disallow under the strict v0.1 plan.
- Bundle impact is zero — motion-dom is already a transitive dependency of `motion`; we're not adding new code to user bundles.
