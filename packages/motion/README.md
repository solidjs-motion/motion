# solidjs-motion

An animation library for [SolidJS](https://solidjs.com) — a port of `motion/react` patterns
built on the framework-agnostic [`motion`](https://motion.dev) package.

> **Status: pre-alpha (0.0.x).** Phases 1 through 4 are landed — the v0.1
> public surface is feature-complete and stabilizing. Live demos:
> [solidjs-motion.github.io/motion](https://solidjs-motion.github.io/motion/).

## Install

### npm

```bash
bun add solidjs-motion motion solid-js
# or: npm i solidjs-motion motion solid-js
```

### JSR

```bash
bunx jsr add @solidjs-motion/motion
```

`motion`, `motion-dom`, and `solid-js` are peer dependencies — install them alongside.

## Quick taste

```tsx
import { useMotion } from "solidjs-motion"

export function Card() {
  const motion = useMotion({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6 },
    hover: { scale: 1.02 },
    press: { scale: 0.98 },
  })

  return <div {...motion({ class: "card" })}>Hello, motion.</div>
}
```

`useMotion` returns a function that merges your props with motion's. User styles deep-merge
with motion's initial styles; user refs and motion's ref both fire; the initial style is
serialized into SSR HTML so the first paint is flicker-free.

## Roadmap

### Shipped

**Canonical hook + imperative primitive**

- `useMotion(opts | () => opts)` — the public API. Returns a callable `motion(userProps?)` that merges with motion's ref/style/data attributes, plus a `motion.Provider` for opt-in variant context propagation.
- `createMotion(el, getOpts)` — the imperative primitive `useMotion` wraps, for advanced use (drag controls, custom directives).

**MotionValue family** (every value is a callable `MotionValueAccessor<T> = MotionValue<T> & (() => T)`)

- `createMotionValue(initial)` — bound to the current owner; auto-disposed on cleanup.
- `createTransform(input, range, output, opts?)` — map a MV/Accessor through a numeric range.
- `createSpring(source, opts?)` — physics-smoothed mirror of a numeric input.
- `createTime()` — frame-driver advancing each animation frame with elapsed ms.
- `createVelocity(source)` — reports the instantaneous velocity of another MV.
- `createTemplate\`…\`` — tagged template producing a `MotionValueAccessor<string>` from interpolated MVs/Accessors.
- `createMotionValueEvent(mv, event, cb)` — subscribe with automatic cleanup.
- `toSignal(rawMv)` — bridge a raw motion `MotionValue` to a Solid Accessor.

**Scroll + viewport**

- `createScroll(opts?)` — `{ scrollX, scrollY, scrollXProgress, scrollYProgress }` MotionValueAccessors.
- `createInView(ref, opts?)` — IntersectionObserver wrapper; `view.isInView()` boolean Accessor, `view.entry()` Accessor of the raw `IntersectionObserverEntry`. Accepts `amount: number[]` for continuous `intersectionRatio` updates.

**Gestures** (declarative on `useMotion` options)

- `hover` / `press` / `focus` — variant or target object per state. State machine resolves per-property winners across simultaneous states (press > focus > hover > inView > animate).
- `inView` — viewport-triggered variant; honors `inViewOptions: ViewportOptions` (margin, amount, root, once).
- Callbacks: `onHoverStart`/`onHoverEnd`, `onPressStart`/`onPress`/`onPressCancel`, `onFocus`/`onBlur`, `onViewportEnter`/`onViewportLeave`.

**Drag**

- `drag: true | "x" | "y"` axis lock, `dragConstraints` (numeric or container ref), `dragElastic`, `dragMomentum`, `dragSnapToOrigin`, `dragTransition`, `whileDrag` for sibling-axis visual state.
- `createPan(ref, opts?)` — standalone pan-session primitive. Returns `{ isPanning, point, delta, offset, velocity }` with MotionValueAccessors at the numeric leaves.
- `createDragControls()` — drag-handle pattern. One element captures the pointer, another moves.

**Variants**

- Named variants on `variants: { … }`. Parent labels cascade to descendants via `motion.Provider`.
- "Controlling variants" rule: a child with its own variant label opts out of the parent cascade (motion-dom parity).
- Dynamic variants: each variant can be a function of `custom` for per-instance staggering and per-index timing.

**Presence + exit animations**

- `<Presence>` — coordinator that runs each child's `exit` target before unmount. Works with `<Show>`, `<For>`, and arbitrary mount/unmount toggles.
- `mode: "sync" | "wait"` — synchronous swap (default) or sequential swap where the outgoing child exits fully before the incoming child enters.
- `initial: false` — suppress the entrance animation for the initial mount; subsequent mounts animate.
- `useAnimatePresence()` — imperative escape hatch returning `{ Provider, exit() }` for cases where you need to await exit completion before flipping state yourself.
- Descendant-walk exit registration: passive children inside `m.Provider` with a `variants` map keyed off the parent's exit label exit alongside the parent automatically (the orchestrated-exit cascade).

**`<motion.X>` proxy + `motion.create(Component)` HOC**

- `motion.div`, `motion.span`, `motion.path` — every HTML/SVG intrinsic element accessed off `motion` returns a typed `Component` whose props are that element's native attributes intersected with `MotionOptions`. SVG namespace handled via `<Dynamic>`.
- Each tag-component auto-wraps its rendered output in `m.Provider`, so variant cascade reaches descendants without manual wrapping for the common case.
- `motion.create(MyComponent)` — HOC for custom components. The wrapped component must forward `props.ref` to a single DOM-element root (Solid's "ref forwarding by convention" reality). A dev-mode warning fires if the wrap is broken.
- See [ADR 0004](../../docs/adr/0004-motion-proxy-and-hoc.md) for the design rationale.

**MV-in-style** (`<motion.div style={{ scale: mv }}>`)

- Pass any `MotionValue` directly in `style` — motion subscribes to it and writes the corresponding DOM property/transform on every change. No React-style re-render cycle.
- Composes with `initial`, `animate`, gestures, and `exit` on the same key: the MV is the source of truth, and animate dispatches tween THROUGH the MV (matches motion-react fidelity).
- Static transform shortcuts (`x: 10`, `scale: 1.5`) also work — motion composes them into the `transform` string in canonical order (translate → scale → rotate).
- SSR-aware: the MV's snapshot value lands in the rendered HTML so client hydration is flicker-free.
- `MotionStyle` type widens `JSX.CSSProperties` to accept `MotionValue` in every slot, plus motion's transform shortcuts.
- See [ADR 0005](../../docs/adr/0005-mv-in-style-value-registry.md) for the per-element value-registry architecture.

**Config + reduced motion**

- `<MotionConfig transition reducedMotion nonce>` — shared defaults for a subtree.
- `createReducedMotion()` — reactive system-pref accessor backed by `matchMedia("(prefers-reduced-motion)")`.

**SSR**

- `useMotion` emits a deterministic inline style + `data-motion-hydrated=""` marker on the server. First paint matches the initial target; the client skips the initial-style application on hydration.

**Re-exports from upstream `motion`**

- `animate`, `inView`, `isMotionValue`, `motionValue`, `scroll`, `spring` — for direct use where the framework wrapper isn't needed.

### Deferred to v0.2+

- Layout animations (`layout` prop, `LayoutGroup`).
- `layoutId` shared-element transitions.
- `<Reorder>` drag-to-reorder primitive.
- SVG path drawing (`<motion.path pathLength>`).
- `useAnimate` imperative AnimationControls equivalent.
- `LazyMotion` lazy-loaded feature bundles.

## License

[MIT](./LICENSE) — copyright the solidjs-motion contributors.
