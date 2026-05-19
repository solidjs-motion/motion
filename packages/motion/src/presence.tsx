import { resolveElements } from "@solid-primitives/refs"
import { createListTransition, createSwitchTransition } from "@solid-primitives/transition-group"
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  Switch,
} from "solid-js"
import { isServer } from "solid-js/web"
import { PresenceContext } from "./presence-context"
import type { MotionElement, PresenceContextValue } from "./types"

// ---------------------------------------------------------------------------
// <Presence> — exit-animation coordinator for motion children.
//
// Architecture (see ADR 0003):
//   - Wraps a conditional JSX subtree (typically `<Show>`, `<For>`, or
//     `<Index>` containing `<motion.*>` elements with `exit` declared).
//   - Resolves children via @solid-primitives/refs (`resolveFirst` /
//     `resolveElements`), then routes them through
//     @solid-primitives/transition-group's `createSwitchTransition` (single)
//     or `createListTransition` (list) which keeps exiting elements in the
//     DOM until we explicitly call `done()`.
//   - Each motion child registers a `runExit` callable via PresenceContext
//     when its `createMotion` runs. The callable flips the state machine's
//     `exit` slot and resolves when the resulting animate settles.
//   - On removal, transition-group calls our `onExit(el, done)`. We look up
//     the registered `runExit` and chain `done` onto its promise. If no
//     `runExit` is registered (a non-motion child, or a motion child with no
//     `exit` prop), `done()` fires immediately and the element disappears.
//
// SSR: pass-through. `isServer` short-circuits the transition-group wiring
// because (a) refs don't exist server-side and (b) no state changes happen
// during renderToString, so there's nothing for the coordinator to do.
// Children render straight through; their initial style is emitted via the
// existing `useMotion` SSR contract.
//
// Single-vs-list dispatch is decided at first resolution and stable for the
// Presence instance's lifetime — switching mid-life would require torn-down
// transition-group state, which neither helper supports. Document the
// constraint (rare in practice; conditional rendering rarely flips between
// "one item" and "many items" without unmount).
// ---------------------------------------------------------------------------

/**
 * Internal helper: maps the public `mode` prop to the value
 * `createSwitchTransition` expects. `popLayout` is intentionally deferred
 * (layout animations are v0.2+); `wait` maps to `out-in`; `sync` is the
 * default and corresponds to transition-group's `parallel`.
 */
function switchMode(mode: PresenceProps["mode"]): "out-in" | "parallel" {
  return mode === "wait" ? "out-in" : "parallel"
}

/**
 * Find every motion child registered under `root` (or root itself) and
 * return their [element, runExit] pairs. Walks the `runExits` map and
 * tests containment via `Node.contains`, which is O(depth) per check —
 * cheap because n is bounded by the number of motion children Presence
 * is tracking. Order isn't load-bearing; callers Promise.all the runExits.
 */
function collectSubtreeExits(
  root: MotionElement,
  runExits: Map<MotionElement, () => Promise<void>>,
): Array<[MotionElement, () => Promise<void>]> {
  const out: Array<[MotionElement, () => Promise<void>]> = []
  for (const [el, fn] of runExits) {
    if (el === root || root.contains(el)) out.push([el, fn])
  }
  return out
}

export type PresenceProps = {
  /**
   * Exit/enter coordination.
   * - `"sync"` (default) — exit and enter overlap (transition-group's
   *   `parallel`). Best for list animations and independent items.
   * - `"wait"` — old child fully exits before the new one enters
   *   (transition-group's `out-in`). Single-child only; ignored (with a
   *   dev-mode warning) when wrapping a list.
   */
  mode?: "sync" | "wait"
  /**
   * Animate children on first mount. Defaults to `true` (matches motion-
   * react). Set `false` to suppress the entry animation for the very first
   * child(ren); subsequent mounts mid-life still animate.
   */
  initial?: boolean
  /**
   * List-path only — controls what transition-group does with an exiting
   * element while its `exit` animation is playing. Forwarded directly to
   * `@solid-primitives/transition-group`'s `createListTransition`.
   *
   * - `"move-to-end"` (default) — the exiting element is appended to the
   *   end of the rendered array so its DOM position changes during exit.
   *   Fine for grids/cascades; surprising for vertically-stacked toasts
   *   because surviving siblings JUMP up while the dismissed item is
   *   still fading out below them.
   * - `"keep-index"` — the exiting element stays at its original index
   *   until exit completes. Surviving siblings don't reflow until the
   *   slot is released. Best default for notification stacks.
   * - `"remove"` — no exit transition; the element is gone from the
   *   rendered array immediately. Useful when the exit is purely visual
   *   on the child (e.g., it self-animates via opacity transitions
   *   instead of `exit`).
   */
  exitMethod?: "move-to-end" | "keep-index" | "remove"
  children: JSX.Element
}

/**
 * Wraps a conditional or iterated JSX subtree and runs the descendants'
 * `exit` targets before they unmount. Matches motion-react's
 * `<AnimatePresence>` shape but with Solid's `<Show>` / `<For>` /
 * `<Index>` patterns instead of conditional children.
 *
 * Nested motion children are first-class: when an ancestor unmounts,
 * Presence walks the subtree from each resolved child and fires every
 * registered `runExit` it finds in parallel — including motion children
 * nested inside plain wrappers, or descendants whose `exit` label was
 * cascaded down via `m.Provider`. Each motion descendant animates with
 * its own variant/target; transition-group only releases the DOM once
 * the combined `Promise.all` settles. Mirrors motion-react's behavior
 * where a `<motion.div exit={...}>` inside an `<AnimatePresence>` boundary
 * animates correctly regardless of depth.
 *
 * @example Single (conditional unmount)
 * <Presence>
 *   <Show when={open()}>
 *     <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
 *       saved
 *     </motion.div>
 *   </Show>
 * </Presence>
 *
 * @example List (items entering and exiting independently)
 * <Presence>
 *   <For each={items()}>
 *     {(item) => (
 *       <motion.li exit={{ opacity: 0, x: 20 }}>{item.text}</motion.li>
 *     )}
 *   </For>
 * </Presence>
 */
export const Presence: Component<PresenceProps> = (props) => {
  // SSR: nothing to coordinate. Children render through their existing
  // useMotion SSR contract.
  if (isServer) return <>{props.children}</>

  // ---------- PresenceContext value supplied to descendants ----------
  const runExits = new Map<MotionElement, () => Promise<void>>()
  // Enter callbacks — symmetric to runExits. createMotion registers a
  // `runEnter` when it's inside this Presence; we fire it the moment the
  // element is actually inserted into the DOM (from transition-group's
  // onEnter / onChange.added). One-shot — deleted after firing so we don't
  // re-trigger the enter animate on subsequent renders.
  const runEnters = new Map<MotionElement, () => void>()
  // `initial` is read at construction. We flip it to `true` after the first
  // microtask so mid-life inserts DO animate even if the user set
  // `initial={false}`. Matches motion-react's behavior.
  const [presenceInitial, setPresenceInitial] = createSignal(props.initial ?? true)
  queueMicrotask(() => setPresenceInitial(true))

  const ctx: PresenceContextValue = {
    register: (el, runExit) => {
      runExits.set(el, runExit)
    },
    unregister: (el) => {
      runExits.delete(el)
    },
    beforeUnmount: (el) => {
      // Walk the subtree rooted at `el` and fire every registered runExit
      // we find — the root's own (if registered) plus every descendant
      // that's a motion child. They all run concurrently; we await the
      // combined Promise.all so transition-group only releases the DOM
      // once every motion descendant has finished its exit, then prune
      // the entries from the registry.
      //
      // This is the mechanism that makes motion-react's parent-cascade
      // exit pattern work for us: when an ancestor unmounts, each nested
      // motion child still runs its OWN exit (its runExit closure already
      // captures the element, `getOpts`, and the state-machine handles,
      // so it doesn't matter that Solid has disposed the surrounding
      // owner). Callers don't need to unregister individually — this
      // method finishes the bookkeeping for the whole subtree.
      const exiting = collectSubtreeExits(el, runExits)
      if (exiting.length === 0) return Promise.resolve()
      return Promise.all(exiting.map((pair) => pair[1]())).then(() => {
        for (const [exitedEl] of exiting) runExits.delete(exitedEl)
      })
    },
    registerEnter: (el, runEnter) => {
      runEnters.set(el, runEnter)
    },
    beforeMount: (el) => {
      const fn = runEnters.get(el)
      runEnters.delete(el)
      fn?.()
    },
    initial: presenceInitial,
  }

  // CRITICAL — the children-resolution dance lives INSIDE the Provider's
  // JSX scope so that:
  //   (a) motion descendants' refs fire under the Provider's owner and
  //       `usePresenceContext` resolves to our `ctx` (not the no-op).
  //   (b) resolveElements is called from a stable, single-execution scope.
  //       solid-motionone's Presence (1.0.4) achieves this by inlining the
  //       transition-group call as the Provider's only child; we extend
  //       that to two paths by routing through a tiny `PresenceCore`
  //       subcomponent so the resolveElements memo isn't recreated.
  return (
    <PresenceContext.Provider value={ctx}>
      <PresenceCore
        source={() => props.children}
        mode={props.mode}
        exitMethod={props.exitMethod}
        appear={presenceInitial}
        ctx={ctx}
      />
    </PresenceContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Internal subcomponent that owns the transition-group machinery. Running
// the resolution + transition-group setup inside a Solid component (rather
// than inline JSX or an IIFE) gives us a clean single-execution scope: the
// component's body runs ONCE per <Presence> instance, the resolveElements
// memo is set up ONCE, and the transition's createComputed is owned by this
// component's lifetime. The Provider's value still flows down because this
// component is rendered AS A CHILD of the Provider.
// ---------------------------------------------------------------------------
type PresenceCoreProps = {
  source: () => JSX.Element
  mode: PresenceProps["mode"]
  exitMethod: PresenceProps["exitMethod"]
  appear: () => boolean
  ctx: PresenceContextValue
}

const PresenceCore: Component<PresenceCoreProps> = (p) => {
  // One resolveElements call — both paths read from it. Calling it twice
  // (e.g. resolveFirst + resolveElements) would create two children-
  // resolution memos and mount the motion descendants twice.
  const resolved = resolveElements(p.source)

  // Sticky single-vs-list decision — DEFERRED until the source resolves
  // to actual data. The earlier "decide at construction" approach silently
  // broke any `<For>` that started empty: `Array.isArray(null)` is false,
  // so we'd lock into switch mode and drop every list item past the first.
  // Using a memo with a self-prev short-circuit makes the decision sticky
  // once a non-null value arrives, while still reacting to the first
  // populated read whenever that happens.
  const path = createMemo<"switch" | "list" | null>((prev) => {
    if (prev) return prev
    const v = resolved()
    if (v == null) return null
    return Array.isArray(v) ? "list" : "switch"
  })

  if (process.env.NODE_ENV !== "production") {
    createEffect(() => {
      if (path() === "list" && p.mode === "wait") {
        console.warn(
          '[solidjs-motion] <Presence mode="wait"> has no meaningful effect with a list of children — "wait" sequences a single exiting element before a single entering one. Use it with `<Show>`-style conditional rendering.',
        )
      }
    })
  }

  // transition-group's helpers return Accessor<Element[]>. Solid renders
  // accessor functions inline (calls them in a tracking scope), but TS
  // sees Accessor, not JSX.Element. The cast is a no-op at runtime.
  //
  // <Switch> + keyed <Match> renders nothing until the path is decided
  // (the children render as null when both Match `when`s are false). The
  // child function form on Match guarantees the create*Transition call
  // happens AT MOST ONCE, on the branch that wins — both paths can't be
  // set up against the same resolveElements memo.
  return (
    <Switch>
      <Match when={path() === "switch"} keyed>
        {(_v) =>
          createSwitchTransition(
            () => {
              const v = resolved()
              return Array.isArray(v) ? (v[0] ?? null) : v
            },
            {
              appear: p.appear(),
              mode: switchMode(p.mode),
              onExit(el, done) {
                // Disable pointer events on the exiting element. In sync
                // mode transition-group keeps the old node in the DOM as
                // a sibling of the new one (with the old one LATER in
                // source order, putting it on top in z-stacking). Without
                // this, the exiting node — even at opacity:0 mid-exit —
                // intercepts pointer events intended for the incoming
                // card, breaking drag and hover on the new element until
                // the exit settles.
                const motionEl = el as MotionElement
                if (
                  motionEl instanceof HTMLElement ||
                  motionEl instanceof SVGElement
                ) {
                  ;(motionEl.style as CSSStyleDeclaration).pointerEvents = "none"
                }
                // beforeUnmount walks the subtree, fires every descendant
                // motion child's runExit in parallel, awaits the combined
                // Promise.all, AND prunes the registry. We just chain
                // done() onto it.
                p.ctx.beforeUnmount(motionEl).then(done)
              },
              onEnter(el, done) {
                // The element was just inserted into the DOM via
                // setReturned (transition-group's createSwitchTransition
                // does this synchronously before invoking onEnter). Fire
                // the child's registered runEnter callback so its state
                // machine can dispatch the first animate against a
                // connected element — without this step, motion's
                // `animate()` would have already completed off-DOM during
                // the surrounding exit (or before the appear-driven
                // insertion). Then unblock transition-group.
                p.ctx.beforeMount?.(el as MotionElement)
                done()
              },
            },
          ) as unknown as JSX.Element
        }
      </Match>
      <Match when={path() === "list"} keyed>
        {(_v) =>
          createListTransition(() => resolved.toArray(), {
            appear: p.appear(),
            exitMethod: p.exitMethod,
            onChange({ added, removed, finishRemoved }) {
              // Fire enter callbacks for added elements first —
              // createListTransition has already updated the source array
              // (and Solid's render diff has inserted the new nodes)
              // before `onChange` runs, so this is the analogue of the
              // switch path's onEnter timing. Without it the new motion
              // children's first animate would have dispatched off-DOM at
              // template instantiation and lost their commitStyles.
              for (const el of added) {
                p.ctx.beforeMount?.(el as MotionElement)
              }
              if (removed.length === 0) return
              // Disable pointer events on every exiting node (see
              // switch-path onExit for the rationale — same z-stacking
              // trap applies when a removed list item lingers as a
              // sibling of new/unchanged ones).
              for (const el of removed as MotionElement[]) {
                if (el instanceof HTMLElement || el instanceof SVGElement) {
                  ;(el.style as CSSStyleDeclaration).pointerEvents = "none"
                }
              }
              // beforeUnmount handles the subtree walk + unregister
              // bookkeeping per root.
              Promise.all(
                (removed as MotionElement[]).map((el) => p.ctx.beforeUnmount(el)),
              ).then(() => finishRemoved(removed))
            },
          }) as unknown as JSX.Element
        }
      </Match>
    </Switch>
  )
}

// ---------------------------------------------------------------------------
// useAnimatePresence — imperative hook variant for library authors.
//
// Returns `{ Provider, exit }`. The user wraps their own conditional
// rendering in the returned Provider and calls `exit()` to trigger exit
// animations on every motion child currently registered. Resolves when all
// settle.
//
// Use this when:
//   - You're a library author whose internal mount state can't be a Solid
//     `<Show>` (e.g., route transitions controlled by an external state
//     machine; toast queues with non-Solid lifecycle).
//   - You need imperative control over WHEN exits trigger (e.g., await
//     network completion before unmounting).
//
// For 95% of application code, prefer `<Presence>` — it handles the
// children-resolver dance and list semantics automatically.
// ---------------------------------------------------------------------------

export type UseAnimatePresenceOptions = {
  /** Same semantics as `<Presence initial>`. Defaults to `true`. */
  initial?: boolean
}

export type UseAnimatePresenceResult = {
  /**
   * Provider component to wrap your conditional rendering. Every motion
   * descendant inside this Provider registers with the hook's internal
   * registry and is reachable via `exit()`.
   */
  Provider: Component<{ children: JSX.Element }>
  /**
   * Trigger exit on every motion child currently registered with this
   * hook. Resolves when all exit animations have settled. Calling `exit()`
   * does NOT unmount anything — the caller is responsible for flipping
   * their mount signal once the promise resolves.
   */
  exit: () => Promise<void>
}

export function useAnimatePresence(options?: UseAnimatePresenceOptions): UseAnimatePresenceResult {
  const runExits = new Map<MotionElement, () => Promise<void>>()
  const [presenceInitial, setPresenceInitial] = createSignal(options?.initial ?? true)
  // Flip to true after the first microtask so mid-life mounts always animate,
  // regardless of the initial setting.
  queueMicrotask(() => setPresenceInitial(true))

  const ctx: PresenceContextValue = {
    register: (el, runExit) => {
      runExits.set(el, runExit)
    },
    unregister: (el) => {
      runExits.delete(el)
    },
    beforeUnmount: (el) => {
      // Mirrors `<Presence>`'s subtree-walk semantics (see its
      // beforeUnmount JSDoc). The hook's own `exit()` API instead
      // iterates the full registry directly — but anyone who hands
      // this ctx to a transition-coordinator that calls `beforeUnmount`
      // gets the same descendant-cascade behavior.
      const exiting = collectSubtreeExits(el, runExits)
      if (exiting.length === 0) return Promise.resolve()
      return Promise.all(exiting.map((pair) => pair[1]())).then(() => {
        for (const [exitedEl] of exiting) runExits.delete(exitedEl)
      })
    },
    initial: presenceInitial,
  }

  // Free the registry on owner disposal. Motion children deliberately do NOT
  // unregister in their own onCleanup (see ADR 0003 — that would race ahead
  // of the exit window), so when the hook's owner unmounts without ever
  // calling exit(), this is the only path that drops the entries.
  onCleanup(() => runExits.clear())

  const Provider: Component<{ children: JSX.Element }> = (p) => (
    <PresenceContext.Provider value={ctx}>{p.children}</PresenceContext.Provider>
  )

  const exit = async (): Promise<void> => {
    // Snapshot the registry at call time so concurrent registrations during
    // the await don't get added to this batch.
    const snapshot = [...runExits.values()]
    await Promise.all(snapshot.map((fn) => fn()))
  }

  return { Provider, exit }
}
