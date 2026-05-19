import { resolveElements } from "@solid-primitives/refs"
import { createListTransition, createSwitchTransition } from "@solid-primitives/transition-group"
import { type Component, createSignal, type JSX, onCleanup } from "solid-js"
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
  children: JSX.Element
}

/**
 * Wraps a conditional or iterated JSX subtree and runs the descendants'
 * `exit` targets before they unmount. Matches motion-react's
 * `<AnimatePresence>` shape but with Solid's `<Show>` / `<For>` /
 * `<Index>` patterns instead of conditional children.
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
      const fn = runExits.get(el)
      return fn ? fn() : Promise.resolve()
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
  appear: () => boolean
  ctx: PresenceContextValue
}

const PresenceCore: Component<PresenceCoreProps> = (p) => {
  // One resolveElements call — both paths read from it. Calling it twice
  // (e.g. resolveFirst + resolveElements) would create two children-
  // resolution memos and mount the motion descendants twice.
  const resolved = resolveElements(p.source)

  // Sticky single-vs-list decision at first read. Switching mid-life would
  // require tearing down whichever transition helper we chose, which
  // neither helper supports. Re-key the surrounding `<Show>` to flip
  // between single and list, if that's ever needed.
  const isList = Array.isArray(resolved())

  if (process.env.NODE_ENV !== "production" && isList && p.mode === "wait") {
    console.warn(
      '[solidjs-motion] <Presence mode="wait"> has no meaningful effect with a list of children — "wait" sequences a single exiting element before a single entering one. Use it with `<Show>`-style conditional rendering.',
    )
  }

  // transition-group's helpers return Accessor<Element[]>. Solid renders
  // accessor functions inline (calls them in a tracking scope), but TS
  // sees Accessor, not JSX.Element. The cast is a no-op at runtime.

  if (!isList) {
    // ---------- Switch path ----------
    return createSwitchTransition(
      () => {
        const v = resolved()
        return Array.isArray(v) ? (v[0] ?? null) : v
      },
      {
        appear: p.appear(),
        mode: switchMode(p.mode),
        onExit(el, done) {
          // Run the registered exit, then unregister + signal done.
          // Unregister AFTER exit (rather than at child cleanup) is the
          // central timing trick — see ADR 0003. createMotion deliberately
          // does NOT unregister on its own owner cleanup, so this is the
          // sole site that prunes the runExits map for the switch path.
          const motionEl = el as MotionElement
          p.ctx.beforeUnmount(motionEl).then(() => {
            p.ctx.unregister(motionEl)
            done()
          })
        },

        onEnter(_el, done) {
          // Entry animations are driven by `useMotion`'s effect on mount,
          // not by us — fire `done` immediately so transition-group
          // doesn't block.
          done()
        },
      },
    ) as unknown as JSX.Element
  }

  // ---------- List path ----------
  // createListTransition exposes `onChange` with `removed` / `added` /
  // `unchanged` / `finishRemoved`. Parallel exits — Promise.all all the
  // registered `runExit`s, unregister each as it settles, then call
  // `finishRemoved(removed)` so transition-group lets Solid dispose those
  // owners.
  return createListTransition(() => resolved.toArray(), {
    appear: p.appear(),
    onChange({ removed, finishRemoved }) {
      if (removed.length === 0) return
      Promise.all(
        (removed as MotionElement[]).map((el) =>
          p.ctx.beforeUnmount(el).then(() => p.ctx.unregister(el)),
        ),
      ).then(() => finishRemoved(removed))
    },
  }) as unknown as JSX.Element
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
      const fn = runExits.get(el)
      return fn ? fn() : Promise.resolve()
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
