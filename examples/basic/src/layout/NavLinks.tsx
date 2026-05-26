import { A, useLocation } from "@solidjs/router"
import { type Accessor, createMemo, createSignal, For, Show } from "solid-js"
import { LayoutGroup, motion } from "solidjs-motion"
import { demos } from "../demos/registry"

// ---------------------------------------------------------------------------
// Shared nav list — rendered both in the desktop sidebar and inside the
// mobile Drawer. Owns the per-link active styling and the per-phase
// grouping.
//
// Two shared-layoutId motion elements give the nav its "indicator follows
// the cursor / the route" feel:
//
//   - `nav-active`: solid primary-color fill that sits behind the
//     currently-active link. When the route changes the same motion
//     element animates between the old and new active link via the
//     layoutId handoff. The accent stripe rides inside it so the
//     "you are here" marker travels as a unit.
//
//   - `nav-hover`: translucent primary fill that sits behind whichever
//     link the cursor is over. Mouse-moving from link A to link B
//     animates the indicator across — same layoutId handoff. Suppressed
//     while hovering the active link (the solid fill already shows the
//     indicator).
//
// Text color uses `mix-blend-mode: difference` over a fixed white
// foreground. The text per-pixel inverts whatever's behind it — page
// background, hover overlay, or the solid active fill — so the color
// "auto-switches" as the indicator animates beneath. No per-link
// state to coordinate with the layout animation: the blend mode
// composites every frame on the GPU and the visual stays in sync with
// the indicator's actual position.
//
// `<LayoutGroup>` scopes both layoutIds to THIS NavLinks instance. The
// component renders twice in AppShell (desktop sidebar + mobile drawer);
// without the scope both instances would compete for the same layoutId
// and the indicator would jump between sidebar and drawer.
//
// `useLocation().pathname` returns the path WITH or WITHOUT the deploy base
// depending on solid-router internals. The strip below handles both cases:
// startsWith returns false when the path is already base-less, leaving the
// pathname unchanged.
// ---------------------------------------------------------------------------

const ROUTER_BASE = __DEPLOY_BASE__.replace(/\/$/, "")

function stripBase(pathname: string): string {
  if (ROUTER_BASE && pathname.startsWith(ROUTER_BASE)) {
    return pathname.slice(ROUTER_BASE.length) || "/"
  }
  return pathname
}

export type NavLinksProps = {
  /** Called whenever a link is tapped — drawer uses this to close. */
  onNavigate?: () => void
}

export function NavLinks(props: NavLinksProps) {
  const grouped = createMemo(() => ({
    phase1: demos.filter((d) => d.phase === 1),
    phase2: demos.filter((d) => d.phase === 2),
    phase3: demos.filter((d) => d.phase === 3),
    phase4: demos.filter((d) => d.phase === 4),
  }))

  // `hoveredPath` is owned at this level so the hover indicator can
  // move ACROSS groups (Phase 1 → Phase 2, etc.) — a per-group signal
  // would scope the layoutId match too narrowly.
  const [hoveredPath, setHoveredPath] = createSignal<string | null>(null)

  const navProps = {
    hoveredPath,
    setHoveredPath,
    onNavigate: props.onNavigate,
  }

  return (
    <LayoutGroup>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: this wrapper exists purely as a mouse-leave catcher for the hover indicator — it has no semantic role and the keyboard-equivalent already exists via the focus state on each <A> child. */}
      <div onMouseLeave={() => setHoveredPath(null)}>
        <NavGroup title="Phase 1" entries={grouped().phase1} {...navProps} />
        <NavGroup title="Phase 2" entries={grouped().phase2} {...navProps} />
        <NavGroup title="Phase 3" entries={grouped().phase3} {...navProps} />
        <NavGroup title="Phase 4" entries={grouped().phase4} {...navProps} />
      </div>
    </LayoutGroup>
  )
}

type NavGroupProps = {
  title: string
  entries: typeof demos
  hoveredPath: Accessor<string | null>
  setHoveredPath: (path: string | null) => void
  onNavigate?: () => void
}

function NavGroup(props: NavGroupProps) {
  const location = useLocation()
  return (
    <nav class="mb-6">
      <div class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        <span class="inline-block h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
        {props.title}
      </div>
      <ul class="m-0 list-none p-0">
        <For each={props.entries}>
          {(entry) => {
            const isActive = createMemo(() => stripBase(location.pathname) === entry.path)
            const isHovered = createMemo(() => props.hoveredPath() === entry.path)
            return (
              <li class="mb-1">
                <A
                  href={entry.path}
                  end
                  onClick={() => props.onNavigate?.()}
                  onMouseEnter={() => props.setHoveredPath(entry.path)}
                  class="group relative block rounded-md py-2 pl-4 pr-3 text-sm no-underline"
                >
                  {/* Hover background — shared layoutId animates between
                      links as the cursor moves. Suppressed on the active
                      link so it doesn't double up with the solid fill. */}
                  <Show when={isHovered()}>
                    <motion.div
                      layoutId="nav-hover"
                      class="pointer-events-none absolute inset-0 rounded-md bg-primary/15"
                    />
                  </Show>
                  {/* Active background — shared layoutId animates between
                      links on route change. The accent stripe rides
                      inside it so the "you are here" marker travels as a
                      single unit. */}
                  <Show when={isActive()}>
                    <motion.div
                      layoutId="nav-active"
                      class="pointer-events-none absolute inset-0 rounded-md bg-active shadow-sm"
                    >
                      <span class="absolute inset-y-1.5 left-1.5 w-1 rounded-full bg-accent" />
                    </motion.div>
                  </Show>
                  {/* Text composites with everything beneath via
                      `mix-blend-mode: difference`. The fixed white
                      foreground inverts per-pixel against the page
                      background, the hover overlay, and the solid
                      active fill — so the visible color auto-tracks
                      whichever the indicator is currently over.
                      `text-white` is just the input to the blend; the
                      rendered color depends entirely on what's behind. */}
                  <span class="relative z-10 mix-blend-difference text-white font-medium">
                    {entry.title}
                  </span>
                </A>
              </li>
            )
          }}
        </For>
      </ul>
    </nav>
  )
}
