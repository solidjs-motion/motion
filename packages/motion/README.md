# solidjs-motion

An animation library for [SolidJS](https://solidjs.com) — a port of `motion/react` patterns
built on the framework-agnostic [`motion`](https://motion.dev) package.

> **Status: pre-alpha (0.0.x).** Phases 1 and 2 of the
> [implementation plan](../../solid-motion-port-plan.md) are landed. Public
> API is stabilizing toward v0.1. Live demos:
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

**Config + reduced motion**

- `<MotionConfig transition reducedMotion nonce>` — shared defaults for a subtree.
- `createReducedMotion()` — reactive system-pref accessor backed by `matchMedia("(prefers-reduced-motion)")`.

**SSR**

- `useMotion` emits a deterministic inline style + `data-motion-hydrated=""` marker on the server. First paint matches the initial target; the client skips the initial-style application on hydration.

**Re-exports from upstream `motion`**

- `animate`, `inView`, `isMotionValue`, `motionValue`, `scroll`, `spring` — for direct use where the framework wrapper isn't needed.

### Next up

- **`<Presence>`** — exit animations. `PresenceContext` is wired with a no-op default today; `<Presence>` will provide the real implementation, registering each child's `exit` target and awaiting completion before unmount.
- **`<motion.div>` / `motion(Component)`** — JSX-level wrappers. `<motion.div>` will be a proxy over every HTML tag; `motion(MyButton)` will be an HOC. Both will auto-propagate variant context so the explicit `<m.Provider>` becomes optional for the common case.

### Deferred to v0.2+

- Layout animations (`layout` prop, `LayoutGroup`).
- `layoutId` shared-element transitions.
- `<Reorder>` drag-to-reorder primitive.
- SVG path drawing (`<motion.path pathLength>`).
- `useAnimate` imperative AnimationControls equivalent.
- `LazyMotion` lazy-loaded feature bundles.

## License

[MIT](./LICENSE) — copyright the solidjs-motion contributors.
