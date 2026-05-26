# Performance

This document is the mental model for thinking about motion's
performance at realistic scale — particularly for `<Reorder.Group>` +
`layout: true`, where item counts can grow into the hundreds. It pairs
with [`bench/BASELINES.md`](./bench/BASELINES.md), which holds the raw
numerical baselines.

## TL;DR

- The library's **JS coordination cost** is measured by the bench
  suite and is well under the per-frame budget at N≤500.
- The **browser's paint / composite / GC cost** is not measured by the
  bench suite. For real perf evaluation you record a DevTools timeline
  on the [`/reorder-perf`](../../examples/basic/src/routes/reorder-perf.tsx)
  stage and read the frame timeline directly.
- At N≈500–700 with fast drags, the linear FLIP-per-row cascade starts
  to dominate. Below that, you don't need to think about it.

## Two-axis cost model

Every motion-driven interaction has two costs that decay independently:

| Axis | What it measures | How we observe it |
|---|---|---|
| JS coordination | Our code: gesture state, FLIP measurement, projection math, MV writes, Solid reconcile | `vitest bench` under jsdom with `animate` mocked |
| Browser cost | WAA setup, GPU layer promotion, paint, composite, GC | DevTools Performance recording on the perf demo |

Conflating the two axes is the most common perf mistake. A bench that
fails at 50,000 ops/sec in JS but renders perfectly at 60fps in
production is not a regression. Conversely, a bench that passes at
1,000 ops/sec but drops frames in DevTools means the browser cost has
shifted — adjust CSS, not library code.

## How to measure

### Quick regression check (JS coordination)

```bash
bun --filter solidjs-motion bench
```

Runs the full bench suite. Numbers go in [`bench/BASELINES.md`](./bench/BASELINES.md).
Use this after any perf-sensitive change to spot >2× deltas. RMEs in
the 10–15% range mean tiny deltas are noise.

The `animate` impl is mocked to a synchronous-resolve thenable, so WAA
cost is excluded by design. The benches measure our coordination
overhead, nothing else.

### Real-browser evaluation (paint + composite + GC)

The bench can't see what the browser actually does. For the full
picture, open `/reorder-perf` in the basic example:

```bash
bun run dev
# navigate to /reorder-perf
```

1. Pick `N` (50 / 100 / 300 / 500 / 1000) and a row variant (`minimal`
   for library overhead, `card` for realistic content).
2. Open Chrome DevTools → Performance tab.
3. Hit Record.
4. Click **Run auto-drag**, or drag the first item manually.
5. Stop. The frame timeline is the authoritative read.

What to look for:

- **Long Tasks** (red triangles) — anything > 50 ms is a frame drop.
- **Frame chart** — solid green = 60fps. Yellow/red = dropped.
- **Bottom-up flame chart** — where the time goes. Look for
  unexpected garbage collection, Recalculate Style spikes, or paint
  rectangles outside the dragged item's region.

The demo deliberately does not run its own timing. The frame timeline
is more honest than any number we could log.

#### Pitfalls when measuring

- **Disable Chrome extensions** for the profiling tab. React DevTools
  in particular adds tens of ms per frame.
- **Disable CPU throttling** in DevTools unless you're specifically
  measuring low-end behaviour. Default throttling makes everything
  look much worse than production hardware.
- **Auto-drag vs. manual drag**: auto-drag is locked to RAF cadence
  (~60Hz) for reproducibility, but synthetic `PointerEvent`s don't
  trigger the full pointer pipeline that real hardware does
  (`getCoalescedEvents`, `pointerrawupdate`, etc.). Use auto-drag for
  consistent recordings; use manual drag for visual smoothness
  evaluation.

## Cost breakdown at realistic sizes

The shape that matters most for `<Reorder.Group>` is **what happens on
a single center-cross during an active drag**. See bench §09 for the
numbers; here's the architectural read:

| Step | Cost shape |
|---|---|
| Composed `onDrag` callback | constant |
| Center-cross loop | O(crossings per tick), bounded by drag speed |
| `internalSetValues` → Solid `<For>` reconcile | O(swapped pair), not O(N) |
| Parent `MutationObserver` fires | one microtask per swap |
| N sibling `runMeasurement` calls | **O(N)** — bcr reads, DOMMatrix parse, ancestor-translate walk |
| FLIP animation dispatch | 2 dispatches per swap; (N − 2) measurements bail at the epsilon check |
| Cumulative-layout-delta MV compensation | constant per swap |

The MO callback's synchronous walk over all N siblings is the linear
term that dominates at large N. It's also the reason the cascade stays
sub-paint correct — measurements happen before the browser repaints,
so siblings can't be observed in a half-swapped state.

Linear extrapolation from bench §09 puts the boundary at N ≈ 500–700
for fast drags (~30 crossings/sec). Below that, the per-frame budget
isn't threatened. Above that, you want either:

1. **Virtualized rendering** — only the visible viewport rows live in
   the DOM. The library doesn't ship a virtual list; pair with
   [`@tanstack/solid-virtual`](https://tanstack.com/virtual) if you
   need it.
2. **A flatter projection-node tree** — out of scope today, but the
   architecture leaves room for it.

## Optimization checklist

In rough priority order:

1. **Use `<Presence exitMethod="keep-index">` when Reorder items have
   `exit`**. The default `move-to-end` shuffles the exiting node to the
   end during its exit window, which fires the layout-coordinator's
   parent-MO mid-fade and visibly slides the item to the bottom
   instead of letting it fade in place. `keep-index` holds the slot
   until exit completes, then survivors FLIP up cleanly. See the
   `<Reorder.Group>` `exit` example in [`reorder.tsx`](./src/reorder.tsx).
2. **`<Reorder.Group>` is already a `layoutScroll` motion element**
   (parity with motion-react). When the group is the scrollable
   viewport (`max-height` + `overflow: auto`), descendant FLIPs
   compensate for scroll offset automatically — you don't need to do
   anything.
3. **Avoid `filter`, `backdrop-filter`, and animated gradients on row
   content during a drag**. These force expensive paints on every
   sibling that gets re-translated. Box-shadow + border + background
   are essentially free on the compositor.
4. **Don't add `will-change: transform` to row elements proactively**.
   The library promotes the dragged item to its own layer when the
   drag starts; promoting every row up front creates GPU memory
   pressure that hurts more than it helps.
5. **Keep row content lean at high N**. The `card` variant in the
   perf demo intentionally uses 3 nested DOM nodes + a few spans;
   that's plausible for production content. Multiple SVG sprites or
   long text runs in every row will dominate paint cost long before
   the library's JS does.
6. **At N ≥ 500, virtualize**. The library's FLIP-per-row cascade is
   O(N) and there's no escape from that in a non-virtualized list.

## Method note

All bench numbers were taken on one machine, one run. **Use them as a
relative regression check, not as a vendor spec.** Re-run on the same
machine after a perf-sensitive change and look for >2× deltas. The
demo recording is the authoritative source of truth for any claim
about real-browser performance — the bench can disagree with the
browser, and when it does, the browser wins.
