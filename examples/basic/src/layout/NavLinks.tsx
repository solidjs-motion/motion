import { A, useLocation } from "@solidjs/router"
import { createMemo, For, Show } from "solid-js"
import { demos } from "../demos/registry"

// ---------------------------------------------------------------------------
// Shared nav list — rendered both in the desktop sidebar and inside the
// mobile Drawer. Owns the per-link active styling and the per-phase
// grouping.
//
// Active treatment: solid primary-color fill (white text) with an
// accent-color stripe pinned to the inside of the left edge. The stripe
// is the "you are here" marker; the primary fill is the structural
// identity. Different roles per color keeps them from clashing — the
// previous blue→yellow gradient tried to blend them at equal weight and
// the values are too different for that to look intentional.
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

  return (
    <>
      <NavGroup title="Phase 1" entries={grouped().phase1} onNavigate={props.onNavigate} />
      <NavGroup title="Phase 2" entries={grouped().phase2} onNavigate={props.onNavigate} />
      <NavGroup title="Phase 3" entries={grouped().phase3} onNavigate={props.onNavigate} />
      <NavGroup title="Phase 4" entries={grouped().phase4} onNavigate={props.onNavigate} />
    </>
  )
}

function NavGroup(props: {
  title: string
  entries: typeof demos
  onNavigate?: () => void
}) {
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
            return (
              <li class="mb-1">
                <A
                  href={entry.path}
                  end
                  onClick={() => props.onNavigate?.()}
                  class="group relative block rounded-md py-2 pl-4 pr-3 text-sm no-underline transition-colors"
                  classList={{
                    "bg-active text-white font-medium shadow-sm": isActive(),
                    "text-fg/85 hover:bg-primary/10 hover:text-fg": !isActive(),
                  }}
                >
                  {/* Active-state stripe — accent-color marker pinned
                      inside the left edge. Inset slightly top/bottom so
                      it doesn't reach the pill's rounded corners. */}
                  <Show
                    when={isActive()}
                    fallback={
                      // Ghost stripe on inactive links: scaleY 0 by
                      // default, scales to 1 on group-hover. Telegraphs
                      // "this is what active looks like" without
                      // committing — and gives every hover a small
                      // beat of motion.
                      <span
                        aria-hidden="true"
                        class="pointer-events-none absolute inset-y-1.5 left-1.5 w-1 origin-center scale-y-0 rounded-full bg-accent/55 transition-transform duration-150 ease-out group-hover:scale-y-100"
                      />
                    }
                  >
                    <span class="pointer-events-none absolute inset-y-1.5 left-1.5 w-1 rounded-full bg-accent" />
                  </Show>
                  {entry.title}
                </A>
              </li>
            )
          }}
        </For>
      </ul>
    </nav>
  )
}
