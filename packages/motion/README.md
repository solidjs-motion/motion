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

## Recipes

### 1. Reactive options

Every primitive that takes an options bag accepts EITHER a static object OR a Solid
`Accessor<Options>` — i.e. a `() => Options` function. The accessor form lets you
read signals inside the options without per-field accessor boilerplate. This is
the canonical reactive escape hatch across the public API:

- `useMotion(opts | () => opts)`
- `createMotion(el, opts | () => opts)`
- `createScroll(opts | () => opts)`
- `createInView(ref, opts | () => opts)`
- `createPan(ref, opts | () => opts)`
- `createSpring(source, opts | () => opts)`
- `createTransform(input, range | () => range, output | () => output, opts?)`

```tsx
import { useMotion } from "solidjs-motion"
import { createSignal } from "solid-js"

export function Toggle() {
  const [open, setOpen] = createSignal(false)
  const motion = useMotion(() => ({
    animate: { rotate: open() ? 180 : 0 },
    transition: { duration: 0.3 },
  }))
  return (
    <button onClick={() => setOpen((p) => !p)} {...motion()}>
      ↑
    </button>
  )
}
```

Same pattern for a scroll-linked progress bar with a swappable container:

```tsx
import { createScroll, createTransform, motion } from "solidjs-motion"
import { createSignal } from "solid-js"

export function ProgressIn(props: { children: any }) {
  const [el, setEl] = createSignal<HTMLElement>()
  // Whole options wrapped in an accessor — swapping `el` re-attaches the
  // scroll subscription. Per-field accessors on `container`/`target` were
  // removed in 0.2.0; this is the supported reactive form.
  const { scrollYProgress } = createScroll(() => ({ container: el() }))
  const width = createTransform(scrollYProgress, [0, 1], ["0%", "100%"])
  return (
    <div ref={setEl} style={{ overflow: "auto", height: "300px" }}>
      <motion.div class="progress" style={{ width }} />
      {props.children}
    </div>
  )
}
```

### 2. `<motion.X>` proxy with variants

Every HTML/SVG tag is reachable off `motion`. Variant labels on the parent cascade to
descendants through `m.Provider` (auto-installed by the proxy).

```tsx
import { motion } from "solidjs-motion"

const variants = {
  rest: { y: 0, scale: 1 },
  lift: { y: -8, scale: 1.04 },
}

export function Card() {
  return (
    <motion.article animate="rest" hover="lift" variants={variants}>
      <motion.h2 variants={variants}>Inherits lift on hover</motion.h2>
    </motion.article>
  )
}
```

### 3. `motion.create(Component)` HOC

Wrap a custom component to make it motion-aware. The wrapped component must spread its
props (including `ref`) onto a single DOM-element root.

```tsx
import { motion } from "solidjs-motion"
import type { ComponentProps } from "solid-js"

function Button(props: ComponentProps<"button">) {
  return <button {...props} class={`btn ${props.class ?? ""}`} />
}

const MotionButton = motion.create(Button)

export function Stage() {
  return (
    <MotionButton hover={{ scale: 1.05 }} press={{ scale: 0.95 }}>
      Press me
    </MotionButton>
  )
}
```

### 4. MotionValues + `createTransform`

MotionValues are the source of truth for animated state. They're both Solid Accessors and
upstream `MotionValue`s — drop them straight into `style`.

```tsx
import { motion, createMotionValue, createTransform } from "solidjs-motion"

export function FadeSlider() {
  const x = createMotionValue(0)
  const opacity = createTransform(x, [-100, 0, 100], [0, 1, 0])
  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: -100, right: 100 }}
      style={{ x, opacity }}
    >
      Drag me
    </motion.div>
  )
}
```

### 5. Spring-smoothed pointer

`createSpring` mirrors any numeric input with physics smoothing.

```tsx
import { motion, createMotionValue, createSpring } from "solidjs-motion"
import { onCleanup, onMount } from "solid-js"

export function Cursor() {
  const x = createMotionValue(0)
  const y = createMotionValue(0)
  const sx = createSpring(x, { stiffness: 200, damping: 30 })
  const sy = createSpring(y, { stiffness: 200, damping: 30 })

  onMount(() => {
    const move = (e: PointerEvent) => {
      x.set(e.clientX)
      y.set(e.clientY)
    }
    window.addEventListener("pointermove", move)
    onCleanup(() => window.removeEventListener("pointermove", move))
  })

  return <motion.div class="cursor" style={{ x: sx, y: sy }} />
}
```

### 6. Scroll-linked progress bar

```tsx
import { motion, createScroll, createTransform } from "solidjs-motion"

export function ProgressBar() {
  const { scrollYProgress } = createScroll()
  const width = createTransform(scrollYProgress, [0, 1], ["0%", "100%"])
  return <motion.div class="progress" style={{ width }} />
}
```

### 7. Viewport-triggered fade-in

```tsx
import { motion } from "solidjs-motion"

export function FadeInOnce() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 40 }}
      inView={{ opacity: 1, y: 0 }}
      inViewOptions={{ once: true, margin: "0px 0px -10% 0px" }}
    >
      Comes in once, stays.
    </motion.section>
  )
}
```

### 8. `createTemplate` for interpolated strings

Build a `MotionValue<string>` from interpolated MVs/Accessors — feed it to any string-valued
CSS property.

```tsx
import { motion, createMotionValue, createTemplate } from "solidjs-motion"

export function GradientBox() {
  const angle = createMotionValue(0)
  const background = createTemplate`linear-gradient(${angle}deg, #f0f, #0ff)`
  return (
    <motion.div
      hover={{ rotate: 360 }}
      transition={{ duration: 2 }}
      style={{ background }}
    />
  )
}
```

### 9. `<Presence>` for exit animations

Wrap a conditionally-rendered child to animate its exit before unmount.

```tsx
import { motion, Presence } from "solidjs-motion"
import { Show, createSignal } from "solid-js"

export function Drawer() {
  const [open, setOpen] = createSignal(false)
  return (
    <>
      <button onClick={() => setOpen((p) => !p)}>Toggle</button>
      <Presence>
        <Show when={open()}>
          <motion.aside
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            transition={{ duration: 0.25 }}
          >
            Drawer content
          </motion.aside>
        </Show>
      </Presence>
    </>
  )
}
```

### 10. `mode="wait"` + list exits

`mode="wait"` plays the outgoing child's `exit` fully before the incoming child enters.
For lists, `Presence` wraps a `<For>` and animates add/remove together.

```tsx
import { motion, Presence } from "solidjs-motion"
import { For, Show, createSignal } from "solid-js"

export function Tabs() {
  const [tab, setTab] = createSignal("a")
  return (
    <Presence mode="wait">
      <Show when={tab()} keyed>
        {(t) => (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            Tab {t}
          </motion.div>
        )}
      </Show>
    </Presence>
  )
}

export function Notifications(props: { items: () => string[] }) {
  return (
    <Presence>
      <For each={props.items()}>
        {(msg) => (
          <motion.li
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
          >
            {msg}
          </motion.li>
        )}
      </For>
    </Presence>
  )
}
```

### 11. Drag with constraints

`dragConstraints` accepts either a numeric rect (`{ top, left, right, bottom }`) or a
container `HTMLElement`. For a reactive container, wrap the surrounding `MotionOptions`
in an accessor (e.g. `useMotion(() => ({ drag: true, dragConstraints: containerEl() }))`)
— the per-field `() => HTMLElement` form was removed in 0.2.0. `dragElastic` controls
overshoot.

```tsx
import { motion } from "solidjs-motion"

export function DraggableCard() {
  let bounds!: HTMLDivElement
  return (
    <div ref={bounds} class="bounds">
      <motion.div
        drag
        dragConstraints={bounds}
        dragElastic={0.2}
        whileDrag={{ scale: 1.05 }}
      >
        Drag inside
      </motion.div>
    </div>
  )
}
```

### 12. `<MotionConfig>` + reduced motion

`<MotionConfig>` flows defaults (transition, reduced-motion mode, CSP nonce) to descendants.
`createReducedMotion()` reads the system preference directly.

```tsx
import { MotionConfig, createReducedMotion, motion } from "solidjs-motion"

export function App() {
  const reduced = createReducedMotion()
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.4, ease: "easeOut" }}>
      <motion.div animate={{ x: 100 }}>Honors `prefers-reduced-motion`</motion.div>
      <p>System reduced-motion: {String(reduced())}</p>
    </MotionConfig>
  )
}
```

### 13. Layout animations

Add `layout` to a motion element and it'll FLIP to its new rect on every layout-affecting
change — sibling add/remove, content reflow, parent's `style`/`class` change, own `ResizeObserver`
firing. The default transition is a critically-damped spring tuned for snappy-but-not-bouncy.

```tsx
import { motion } from "solidjs-motion"
import { For, createSignal } from "solid-js"

let nextId = 3
const INITIAL = [{ id: "1", label: "Task one" }, { id: "2", label: "Task two" }]

export function StackedCards() {
  const [items, setItems] = createSignal(INITIAL)
  return (
    <>
      <button onClick={() => setItems((p) => [{ id: `${++nextId}`, label: `Task ${nextId}` }, ...p])}>
        + add
      </button>
      <ul>
        <For each={items()}>
          {(item) => (
            <motion.li layout>
              {item.label}
              <button onClick={() => setItems((p) => p.filter((i) => i.id !== item.id))}>×</button>
            </motion.li>
          )}
        </For>
      </ul>
    </>
  )
}
```

### 14. Shared-element transitions with `layoutId`

Two motion elements with the same `layoutId` in the same `<LayoutGroup>` scope hand off
animation rect across an unmount/mount. Pair with `<Presence>` so the donor's `exit` and
the consumer's enter FLIP run in parallel.

```tsx
import { motion, Presence } from "solidjs-motion"
import { Show, createSignal } from "solid-js"

export function ExpandableCard() {
  const [open, setOpen] = createSignal(false)
  return (
    <Presence>
      <Show
        when={open()}
        keyed
        fallback={
          <motion.button layoutId="card" onClick={() => setOpen(true)} class="thumb">
            Open
          </motion.button>
        }
      >
        <motion.div layoutId="card" onClick={() => setOpen(false)} class="hero">
          Hero content
        </motion.div>
      </Show>
    </Presence>
  )
}
```

### 15. Reorder list (drag + add/remove)

`<Reorder.Group>` + `<Reorder.Item>` for drag-to-reorder. Each Item gets `layout: true`
+ `drag: <axis>` automatically. Pair with `<Presence exitMethod="keep-index">` when items
have `exit` declared — the default `exitMethod` (`"move-to-end"`) shuffles the exiting
node to the end of the list during its fade, hiding the exit visually.

```tsx
import { Presence, Reorder } from "solidjs-motion"
import { For, createSignal } from "solid-js"

let nextId = 3
const INITIAL = [{ id: "1", label: "First" }, { id: "2", label: "Second" }]

export function TaskList() {
  const [items, setItems] = createSignal(INITIAL)
  const add = () =>
    setItems([{ id: `${++nextId}`, label: `Task ${nextId}` }, ...items()])
  const remove = (id: string) => setItems(items().filter((i) => i.id !== id))

  return (
    <>
      <button onClick={add}>+ add</button>
      <Reorder.Group values={items} onReorder={setItems}>
        <Presence exitMethod="keep-index">
          <For each={items()}>
            {(item) => (
              <Reorder.Item
                value={item}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {item.label}
                <button onClick={() => remove(item.id)}>×</button>
              </Reorder.Item>
            )}
          </For>
        </Presence>
      </Reorder.Group>
    </>
  )
}
```

## Roadmap

### Shipped

**Canonical hook + imperative primitive**

- `useMotion(opts | Accessor<opts>)` — the public API. Returns a callable `motion(userProps?)` that merges with motion's ref/style/data attributes, plus a `motion.Provider` for opt-in variant context propagation.
- `createMotion(el, opts | Accessor<opts>)` — the imperative primitive `useMotion` wraps, for advanced use (drag controls, custom directives).

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

- `drag: true | "x" | "y"` axis lock, `dragConstraints` (numeric rect or container `HTMLElement`), `dragElastic`, `dragMomentum`, `dragSnapToOrigin`, `dragTransition`, `whileDrag` for sibling-axis visual state.
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

**Layout animations** (new in 0.2.0)

- `layout: true | "position" | "size" | "preserve-aspect"` — per-element FLIP from First to Last rect on every layout-affecting change (parent reorder, sibling add/remove, content reflow, ResizeObserver self, parent `style`/`class` change). Critically-damped spring default transition tuned for snappy-but-not-bouncy.
- `layoutId` — cross-element handoff. Two elements with the same id (within the same `<LayoutGroup>` scope) animate seamlessly across an unmount/mount. Pairs with `<Presence>` for parallel exit + enter FLIP.
- `<LayoutGroup>` scopes `layoutId` namespacing AND broadcasts dependency changes group-wide.
- `layoutScroll`, `layoutRoot`, `layoutAnchor`, `layoutDependency`, `layoutTransition` for finer control.
- `onLayoutAnimationStart` / `onLayoutAnimationComplete` lifecycle callbacks.
- `Target` accepts every CSS property via `csstype.PropertiesHyphen` — hyphenated keys (`box-shadow`, `background-color`, `--my-custom-prop`) are first-class in `animate`, gesture targets, and `style`.

**Reorder** (new in 0.2.0)

- `<Reorder.Group values onReorder>` + `<Reorder.Item value>` — drag-to-reorder. Items get `layout: true` + `drag: <axis>` automatically; the dragged row tracks the pointer, siblings FLIP into their new slots, list mutation happens live (no preview state).
- `createReorder(values, setValues, options?)` — the primitive that backs the components. Accepts either `Accessor<T[]>` (signal) or `T[]` (store).
- Drag-handle pattern via existing `dragListener: false` + `dragControls={controls}` — the row's body stays interactive, drag initiation scoped to a dedicated handle.
- `cancelOnExternalReorder` for strict mutation guards.
- Reorder.Item provides variant context to descendants (nested `<motion.button>` inside a row inherits the item's `animate` / `hover` / `whileDrag` / `exit` labels).
- Pair with `<Presence exitMethod="keep-index">` when items have `exit` declared.

**Improved revert behavior** (new in 0.2.0)

- **Originals tracking** — on first paint, the element's computed style is captured for every gesture-target key that has no canonical motion default (anything outside transforms + opacity). When a gesture deactivates and `animate` doesn't claim the key, the captured original is the revert target. No more redundant `animate.box-shadow` workaround.
- **`whileDrag` propagates through variant context** — descendants wrapped in `m.Provider` with a matching label in `variants` respond to the parent's drag state, same as `whileHover` / `whilePress` / `whileFocus` / `whileInView`.

**Re-exports from upstream `motion`**

- `animate`, `inView`, `isMotionValue`, `motionValue`, `scroll`, `spring` — for direct use where the framework wrapper isn't needed.

### Deferred to v0.3+

- SVG path drawing (`<motion.path pathLength>`).
- `useAnimate` imperative AnimationControls equivalent.
- `LazyMotion` lazy-loaded feature bundles.
- Generalized shadow-shape normalization (currently only `"none"`/`""` are normalized for box/text-shadow).
- Default `exitMethod="keep-index"` on `<Presence>` (currently "move-to-end"; would be a breaking change).

## License

[MIT](./LICENSE) — copyright the solidjs-motion contributors.
