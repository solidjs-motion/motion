import { Dialog } from "@kobalte/core/dialog"
import type { JSX } from "solid-js"
import { Show } from "solid-js"
import { createDragControls, motion, type PanInfo, Presence } from "solidjs-motion"
import { NavLinks } from "./NavLinks"

// ---------------------------------------------------------------------------
// MobileDrawer — Kobalte Dialog as the a11y/portal/focus shell, motion as
// the animation + drag layer.
//
// Lifecycle via <Presence> + variant orchestration:
//   - <Presence> wraps a <Show when={open()}>; the drawer subtree mounts
//     on open and unmounts after the exit animation completes.
//   - Inside, a single <motion.div class="contents"> wrapper is the
//     controlling node:
//         initial = "closed"   ← drawer is off-screen on mount
//         animate = "open"     ← slide in
//         exit    = "closed"   ← slide back out on unmount
//     Its `variants={{ closed: {}, open: {} }}` are empty bodies — the
//     wrapper is label-only. Each descendant (overlay + drawer aside)
//     has its OWN variants map for those names but NO animate/initial/
//     exit label of its own, so they inherit the wrapper's label via the
//     m.Provider context cascade and resolve it against their own
//     variant bodies. One label flip orchestrates everything together.
//   - "closed" doubles as both the initial position AND the exit target,
//     so we declare each variant body once instead of mirroring exit and
//     initial separately.
//
// Layout integration:
//   - Dialog.Overlay → wrapped with motion.create for the backdrop fade.
//   - Dialog.Content → rendered with class="contents" (display: contents)
//     so its element exists for ARIA/focus-trap purposes but contributes
//     no layout box. The visible drawer is a sibling motion.aside that
//     we own end-to-end.
//
// Drag-to-close uses motion's `drag` API with `createDragControls` so the
// right-edge handle drives the drag pan-session on the drawer surface.
// `onDragEnd` flips the controlled `open()` signal to false when past the
// close threshold; the variant cascade then animates the rest of the way
// out through <Presence>'s exit phase.
// ---------------------------------------------------------------------------

const DRAWER_WIDTH = 320

// motion-aware wrapper around Kobalte's Overlay. Defined at module scope
// so the wrapping (and HMR-relevant identity) happens once.
const MotionOverlay = motion.create(Dialog.Overlay)

const overlayVariants = {
  closed: { opacity: 0 },
  open: { opacity: 1 },
}

const drawerVariants = {
  closed: { x: "-120%" },
  open: { x: "0%" },
}

// Wrapper is label-only — `animate="open" + exit="closed"` flow to
// descendants via the m.Provider cascade and each descendant resolves
// the name in its OWN variants map (Pattern X / Q4 sub-1B). Empty
// target bodies here: the wrapper itself doesn't animate any prop,
// it just orchestrates.
const wrapperVariants = {
  closed: {},
  open: {},
}

export type MobileDrawerProps = {
  open: () => boolean
  onOpenChange: (open: boolean) => void
  trigger: (state: "closed" | "open") => JSX.Element
}

export function MobileDrawer(props: MobileDrawerProps) {
  return (
    <Dialog open={props.open()} onOpenChange={props.onOpenChange} forceMount>
      <Dialog.Trigger
        class="inline-flex h-10 w-10 items-center justify-center rounded-md text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary"
        aria-label={props.open() ? "Close navigation" : "Open navigation"}
      >
        {props.trigger(props.open() ? "open" : "closed")}
      </Dialog.Trigger>

      <Dialog.Portal>
        <Presence>
          <Show when={props.open()}>
            <DrawerSurface onClose={() => props.onOpenChange(false)} />
          </Show>
        </Presence>
      </Dialog.Portal>
    </Dialog>
  )
}

function DrawerSurface(props: { onClose: () => void }) {
  const controls = createDragControls()

  // Motion's `onDragEnd: (PointerEvent, PanInfo) => void` collides with
  // the native HTMLElement `ondragend: (DragEvent) => void` once motion's
  // typed prop bag intersects HTMLAttributes. Same name, different
  // signature. The runtime fires motion's variant; we cast at the call
  // site to keep the rest of the prop bag typed.
  const onDragEnd = (_e: PointerEvent, info: PanInfo): void => {
    const past30 = info.offset.x < -DRAWER_WIDTH * 0.3
    const fastFlick = info.velocity.x < -500
    if (past30 || fastFlick) {
      // Flip the controlled signal — Presence + the variant cascade then
      // animate the drawer (and overlay) to "closed" and unmount.
      // Safe to flip synchronously: motion's `onDragEnd` fires at the
      // end of pan-end (post-cleanup, post-momentum-dispatch), so the
      // reactive cascade can't race motion's DOM-touching work.
      props.onClose()
    }
  }

  return (
    <motion.div
      class="contents"
      initial="closed"
      animate="open"
      exit="closed"
      variants={wrapperVariants}
    >
      <MotionOverlay
        variants={overlayVariants}
        transition={{ duration: 0.2 }}
        class="fixed inset-0 z-40 bg-black/45"
      />
      <Dialog.Content class="contents">
        <motion.aside
          variants={drawerVariants}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          drag="x"
          dragControls={controls}
          dragConstraints={{ left: -DRAWER_WIDTH, right: 0 }}
          dragElastic={0}
          dragSnapToOrigin
          // No dragSnapToOrigin: on release, the variant cascade owns the
          // post-drag animation. active.whileDrag flips false → animate's
          // x="0%" (from the "open" cascade) becomes the winner again →
          // the diff effect dispatches the spring-back automatically. If
          // we left dragSnapToOrigin on, it would fire animate(el,{x:0})
          // simultaneously and fight the cascade — visible most clearly
          // on a commit-to-close release where the cascade wants
          // x:"-100%" but the snap-back insists on x:0.
          // biome-ignore lint/suspicious/noExplicitAny: motion's onDragEnd (PointerEvent, PanInfo) collides with native ondragend (DragEvent)
          onDragEnd={onDragEnd as any}
          class="fixed left-0 top-0 z-50 flex h-full w-80 flex-col border-r border-border bg-elevated shadow-xl"
        >
          <div class="flex items-center justify-between border-b border-border-soft px-4 py-3">
            <Dialog.Title class="text-base font-semibold">
              <span class="text-primary">solidjs-</span>
              <span class="border-b-2 border-accent text-primary">motion</span>
            </Dialog.Title>
            <Dialog.CloseButton
              class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-primary/10 hover:text-fg focus-visible:outline-2 focus-visible:outline-primary"
              aria-label="Close navigation"
            >
              <svg
                viewBox="0 0 20 20"
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
                role="presentation"
              >
                <path d="M5 5l10 10M15 5L5 15" stroke-linecap="round" />
              </svg>
            </Dialog.CloseButton>
          </div>
          <div class="flex-1 overflow-y-auto px-4 py-4">
            <NavLinks onNavigate={() => props.onClose()} />
          </div>
          {/*
            Drag handle — a tab that extends FULLY outside the drawer's
            right edge (no overlap on the drawer body) so it reads as a
            distinct affordance. Wraps a centered pill with breathing
            room on both sides. `controls.start(e)` triggers motion's
            drag pan-session on the parent motion.aside; `touch-action:
            none` keeps mobile browsers from interpreting the horizontal
            swipe as a scroll.
          */}
          <span
            aria-hidden="true"
            onPointerDown={(e) => controls.start(e)}
            class="absolute top-1/2 -right-7 flex h-14 w-7 -translate-y-1/2 cursor-grab items-center justify-center rounded-r-lg border border-l-0 border-border bg-elevated px-1.5 shadow-md active:cursor-grabbing"
            style={{ "touch-action": "none" }}
          >
            <span class="block h-8 w-1 rounded-full bg-accent" />
          </span>
        </motion.aside>
      </Dialog.Content>
    </motion.div>
  )
}
