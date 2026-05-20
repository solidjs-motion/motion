# Bench baselines

Initial micro-bench snapshot captured during Phase 4 ship. These are
**jsdom** numbers, not real-browser numbers — useful for relative
regression detection between commits, NOT as absolute promises to users.

## Environment

| | |
|---|---|
| CPU | AMD Ryzen AI 9 365 (20 logical cores) |
| OS | Linux 6.6 (WSL2) |
| Node | v25.8.1 |
| Vitest | 4.1.6 |
| Test environment | jsdom |
| Animate impl | `vi.mock("motion")` returns a synchronous-resolve thenable, so WAA cost is excluded; we measure JS coordination only |

Run with `bun --filter solidjs-motion bench` from the repo root, or
`bun run bench` from `packages/motion/`.

## Per-bench results

Format: ops/sec (higher is better). `mean` and `p99` are per-call time
in milliseconds. `rme` = relative margin of error.

### 01 — `motion.div` proxy get vs full mount

| Bench | ops/sec | mean (ms) | p99 (ms) | rme |
|---|--:|--:|--:|--:|
| `motion.div` property access (cache hit) | 15,334,138 | 0.0001 | 0.0001 | ±1.18% |
| `motion.span` property access (cache hit) | 13,353,794 | 0.0001 | 0.0002 | ±1.04% |
| `<motion.div animate={{ x: 100 }} />` mount | 3,356 | 0.298 | 1.13 | ±11.95% |
| `<div {...useMotion({ animate: { x: 100 } })()} />` mount | 4,534 | 0.221 | 0.87 | ±14.90% |

**Read.** The cached get-trap is essentially free (~65 ns). Going through
the proxy at mount time costs ~35% over hand-written `useMotion +
splitProps + Provider` — that's the `splitProps(MOTION_OPT_KEYS)` walk,
the `m.Provider` wrap, and the `<Dynamic>` indirection. Worth it for the
ergonomic win.

### 02 — `useMotion` mount, option-shape comparison

| Bench | ops/sec | mean (ms) | p99 (ms) |
|---|--:|--:|--:|
| no opts: `useMotion({})` | 5,349 | 0.187 | 0.74 |
| simple animate target | 4,819 | 0.207 | 0.78 |
| variant-driven (cascade-ready map) | 5,884 | 0.170 | 0.64 |
| callback-heavy (lifecycle hooks) | 5,173 | 0.193 | 0.65 |
| drag-enabled | 5,678 | 0.176 | 0.63 |

**Read.** Mount cost is dominated by Solid's tree setup; the option
shape barely moves the needle. Drag isn't notably more expensive at
mount because the pan/drag handlers attach lazily on pointerdown.

### 03 — State machine flip (`setActive` → winners → animate dispatch)

| Bench | ops/sec | mean (ms) | p99 (ms) |
|---|--:|--:|--:|
| hover flip → animate dispatched | 91,056 | 0.011 | 0.054 |
| press flip → animate dispatched | 91,570 | 0.011 | 0.069 |

**Read.** A flip is ~11 µs. Each frame at 60fps is 16.7 ms, so we have
~1,500× headroom per frame for a single gesture activation.

### 04 — MotionValue fanout

| Bench | ops/sec | mean (µs) |
|---|--:|--:|
| `mv.set` → 1 subscriber | 1,621,835 | 0.6 |
| `mv.set` → 10 subscribers | 652,610 | 1.5 |
| `mv.set` → 100 subscribers | 89,435 | 11.2 |

**Read.** Cost grows roughly linearly with subscriber count. 100
subscribers in 11 µs is fine for any realistic transform-chain depth.

### 05 — MotionValue construction

| Bench | ops/sec | mean (µs) |
|---|--:|--:|
| `createMotionValue(0)` | 476,578 | 2.1 |
| `createMotionValue('100px')` | 465,225 | 2.1 |
| 10× `createMotionValue` in one root | 50,993 | 19.6 |

**Read.** A single MV costs ~2 µs. The 10× case is ~10× a single
construction, confirming no shared-setup overhead.

### 06 — Drag tick (single pointermove during active drag)

| Bench | ops/sec | mean (µs) | p99 (µs) |
|---|--:|--:|--:|
| pointermove tick (x-axis, mid-session) | 244,255 | 4.1 | 17.9 |

**Read.** Each pointermove costs ~4 µs in JS. At a sustained 60fps
input rate (one move per frame), that's <0.03% of the frame budget —
essentially free. Real-browser numbers will be lower because the
compositor handles transforms off-thread, but the JS coordination cost
is what matters for the main thread.

### 07 — Variant resolution

| Bench | ops/sec | mean (µs) |
|---|--:|--:|
| static variant lookup (`'visible'`) | 10,859,720 | 0.09 |
| function variant with `custom` prop | 9,795,017 | 0.10 |
| array merge `['visible', 'highlighted']` | 7,345,274 | 0.14 |
| missing variant (returns null) | 14,901,894 | 0.07 |

**Read.** Variant resolution is essentially free — well under a
microsecond in every shape.

### 08 — Presence enter+exit roundtrip

| Bench | ops/sec | mean (ms) | p99 (ms) |
|---|--:|--:|--:|
| `<Presence><Show when>{motion.div w/ exit}</Show></Presence>` | 1,323 | 0.756 | 2.56 |

**Read.** A full mount → exit-animate → unmount cycle costs ~0.76 ms.
With the animate impl mocked to resolve synchronously, this is the JS
coordination cost (PresenceCore setup, deferred path-decision memo,
createSwitchTransition wiring, ref/static-style application, exit
dispatch chain, subtree-walk registry pruning). The real perceived cost
in production is dominated by the animate duration itself.

## Method note

These numbers were taken on one machine, one run. **Use them as a
relative regression check, not as a vendor spec.** Re-run on the same
machine after a perf-sensitive change and look for a >2× delta as the
"investigate this" threshold. RMEs in the 10-15% range on the slower
benches mean tiny deltas are noise, not signal.

The `then`-thenable mock on `animate` short-circuits the WAA cost so
these benches measure the library's JS overhead, not the browser's
animation runtime. That's deliberate — WAA cost is a browser concern
and benchmarking it under jsdom would be meaningless.
