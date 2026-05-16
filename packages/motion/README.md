# solidjs-motion

An animation library for [SolidJS](https://solidjs.com) — a port of `motion/react` patterns
built on the framework-agnostic [`motion`](https://motion.dev) package.

> **Status: pre-alpha (0.0.x).** Phase 0 of the [implementation plan](../../solid-motion-port-plan.md)
> ships only the workspace scaffold. The real `useMotion` primitive arrives in Phase 1.

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

`motion` and `solid-js` are peer dependencies — install them alongside.

## Quick taste (Phase 1+)

```tsx
import { useMotion } from "solidjs-motion"

export function Card() {
  const motion = useMotion({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6 },
  })

  return <div {...motion({ class: "card" })}>Hello, motion.</div>
}
```

`useMotion` returns a function that merges your props with motion's. User styles deep-merge
with motion's initial styles; user refs and motion's ref both fire; the initial style is
serialized into SSR HTML so the first paint is flicker-free.

## Roadmap

See [`solid-motion-port-plan.md`](../../solid-motion-port-plan.md) for the full plan. v0.1
targets ~90% of common `motion/react` usage:

- Declarative `animate` / `exit` props
- Hover / press / drag / inView gestures
- Variants
- `<Presence>` for exit animations
- `<Motion as="...">` polymorphic component
- Full SSR support

Deferred to v0.2+: layout animations, `layoutId` shared-element transitions, scroll-linked
animations, SVG path drawing.

## License

[MIT](./LICENSE) — copyright the solidjs-motion contributors.
