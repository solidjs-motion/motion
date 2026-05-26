import { A, useLocation } from "@solidjs/router"
import { createMemo, createSignal, type ParentProps, Show } from "solid-js"
import { motion, Presence } from "solidjs-motion"
import { DemoSource } from "../components/DemoSource"
import { demos } from "../demos/registry"
import { Hamburger } from "./Hamburger"
import { MobileDrawer } from "./MobileDrawer"
import { NavLinks } from "./NavLinks"
import { Wordmark } from "./Wordmark"

// ---------------------------------------------------------------------------
// AppShell — responsive chrome.
//
// Mobile (< md): sticky top app bar (hamburger + wordmark), nav lives in
//   <MobileDrawer> (Kobalte Dialog + motion).
// Desktop (md+):  persistent left sidebar, no top bar.
//
// stripBase / activeDemo: `useLocation().pathname` may return paths with
// or without the deploy prefix depending on solid-router internals. The
// strip is a no-op when the path is already base-less.
// ---------------------------------------------------------------------------

const ROUTER_BASE = __DEPLOY_BASE__.replace(/\/$/, "")

function stripBase(pathname: string): string {
  let stripped = pathname
  if (ROUTER_BASE && stripped.startsWith(ROUTER_BASE)) {
    stripped = stripped.slice(ROUTER_BASE.length) || "/"
  }
  // GitHub Pages serves the prerendered `/motion/drag/index.html` under
  // `/motion/drag/` — see the matching note in NavLinks. Strip a
  // trailing slash on anything other than root so registry lookups
  // (which use unslashed entry paths) match either form.
  if (stripped.length > 1 && stripped.endsWith("/")) {
    stripped = stripped.slice(0, -1)
  }
  return stripped
}

export function AppShell(props: ParentProps) {
  const location = useLocation()
  const activeDemo = createMemo(() => {
    const path = stripBase(location.pathname)
    return demos.find((d) => d.path === path)
  })
  const [drawerOpen, setDrawerOpen] = createSignal(false)

  return (
    <div class="min-h-screen bg-bg font-sans text-fg">
      {/* Mobile top app bar — hidden on md+ */}
      <header class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg/95 px-3 backdrop-blur md:hidden">
        <MobileDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          trigger={(state) => <Hamburger state={state} />}
        />
        <A href="/" class="font-semibold no-underline">
          <Wordmark />
        </A>
      </header>

      <div class="flex">
        {/* Desktop sidebar — hidden on mobile */}
        <motion.aside
          class="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-border bg-surface px-4 py-6 md:block"
          layoutScroll
        >
          <A href="/" class="mb-6 block text-base font-bold no-underline">
            <Wordmark />
          </A>
          <NavLinks />
        </motion.aside>

        <main class="flex-1 px-4 py-6 md:px-12 md:py-10">
          <div class="mx-auto max-w-3xl">
            {/*
              Per-route page transition. `<Presence mode="wait">` keyed on
              the route path remounts a fresh <motion.div> on every
              navigation; the outgoing one exits before the incoming one
              enters. Subtle y-lift (8 → 0) + fade gives every nav click
              a "the new demo just arrived" beat without delaying perceived
              load. Title + blurb + DemoSource ride inside, so they also
              re-enter together.
            */}
            <Presence mode="wait">
              <Show when={location.pathname} keyed>
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1], delayChildren: 0.5 }}
                >
                  <Show when={activeDemo()}>
                    {(demo) => (
                      <header class="mb-8">
                        <h1 class="m-0 mb-2 text-2xl font-semibold tracking-tight md:text-3xl">
                          {demo().title}
                        </h1>
                        <p class="m-0 text-muted">{demo().blurb}</p>
                      </header>
                    )}
                  </Show>
                  {props.children}
                  <Show when={activeDemo()}>
                    {(demo) => <DemoSource source={demo().source} filename={demo().filename} />}
                  </Show>
                </motion.div>
              </Show>
            </Presence>
          </div>
        </main>
      </div>
    </div>
  )
}
