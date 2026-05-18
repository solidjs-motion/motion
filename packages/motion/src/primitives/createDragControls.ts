import type { DragControls, DragControlsStartOptions } from "../types"

// ---------------------------------------------------------------------------
// createDragControls — imperative drag-controls factory (Q9).
//
// Architecture:
// - A controls instance has one public method: `start(event, options?)`.
// - createDrag (when its `opts.dragControls === thisInstance`) registers a
//   handler via the symbol-keyed internal property defined below. The
//   handler synthesizes a drag session from the externally-captured pointer
//   event, bypassing the usual threshold gate.
// - One controls instance binds to one motion element at a time (Q9d).
//   When a second element registers, the first is silently replaced. On
//   unmount, only unregister if we're still the registered handler — avoid
//   clobbering a later registration.
//
// Internal registration:
// - We attach a `_register(handler)` method to a non-enumerable symbol-keyed
//   property (Q9e), keeping the public `DragControls` type clean. The
//   symbol is exported as `DRAG_CONTROLS_REGISTER` for createDrag to find,
//   but users importing only `DragControls` never see it.
// ---------------------------------------------------------------------------

/**
 * Symbol used to attach the registration method on the controls object.
 * `createDrag` imports this symbol to find/register its handler. Userland
 * code never touches it — exported only for library-internal use.
 */
export const DRAG_CONTROLS_REGISTER = Symbol("solidjs-motion.dragControls.register")

/**
 * Internal registration signature — the handler that createDrag installs.
 * Returns an unregister function (called on owner disposal).
 */
type RegistrationFn = (
  handler: (event: PointerEvent, options: DragControlsStartOptions) => void,
) => () => void

/** Public + internal shape of the controls returned by `createDragControls`. */
type DragControlsInternal = DragControls & {
  [DRAG_CONTROLS_REGISTER]: RegistrationFn
}

/**
 * Create a controls instance for imperatively starting a drag on a motion
 * element from a different element (e.g., a drag-handle button).
 *
 * Pattern (Q9):
 *
 * @example
 * function Card() {
 *   const controls = createDragControls()
 *   const m = useMotion({ drag: "y", dragControls: controls })
 *   return (
 *     <div {...m()}>
 *       <button onPointerDown={(e) => controls.start(e)}>handle</button>
 *       Card body
 *     </div>
 *   )
 * }
 *
 * The handle's pointerdown fires `controls.start(event)`. createDrag is
 * registered with the controls and translates the call into a pan-session
 * synthesized from the handle's event, bypassing the threshold gate.
 */
export function createDragControls(): DragControls {
  let handler: ((event: PointerEvent, options: DragControlsStartOptions) => void) | null = null

  // Public surface — `start` is the only enumerable property.
  const controls: DragControlsInternal = {
    start(event: PointerEvent, options: DragControlsStartOptions = {}) {
      // No-op when no motion element is currently registered. Matches
      // motion/react's behavior: the user's pointerdown handler can be
      // attached unconditionally, and start() is harmless until binding.
      handler?.(event, options)
    },
    // Placeholder — filled in immediately below via Object.defineProperty
    // so the property is non-enumerable.
    [DRAG_CONTROLS_REGISTER]: undefined as unknown as RegistrationFn,
  }

  // Q9e — registration internals on a non-enumerable property keyed by
  // Symbol. Type-level the property is on DragControlsInternal, but the
  // public DragControls type omits it — userland sees only `.start`.
  Object.defineProperty(controls, DRAG_CONTROLS_REGISTER, {
    value: ((newHandler) => {
      handler = newHandler
      // Q9d — return an unregister that only nulls out if we're still the
      // active handler. Prevents a stale unmount from clobbering a later
      // registration on the same controls instance.
      return () => {
        if (handler === newHandler) handler = null
      }
    }) satisfies RegistrationFn,
    enumerable: false,
    writable: false,
    configurable: false,
  })

  return controls
}
