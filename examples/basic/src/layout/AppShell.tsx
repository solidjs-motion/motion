import { A, useLocation } from "@solidjs/router"
import { createMemo, createSignal, type ParentProps, Show } from "solid-js"
import { DemoSource } from "../components/DemoSource"
import { demos } from "../demos/registry"
import { Hamburger } from "./Hamburger"
import { MobileDrawer } from "./MobileDrawer"
import { NavLinks } from "./NavLinks"

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
  if (ROUTER_BASE && pathname.startsWith(ROUTER_BASE)) {
    return pathname.slice(ROUTER_BASE.length) || "/"
  }
  return pathname
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
          <span class="text-primary">solidjs-</span>
          <span class="border-b-2 border-accent text-primary">motion</span>
        </A>
      </header>

      <div class="flex">
        {/* Desktop sidebar — hidden on mobile */}
        <aside class="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-border bg-surface px-4 py-6 md:block">
          <A href="/" class="mb-6 block text-base font-bold no-underline">
            <span class="text-primary">solidjs-</span>
            <span class="border-b-2 border-accent text-primary">motion</span>
          </A>
          <NavLinks />
        </aside>

        <main class="flex-1 px-4 py-6 md:px-12 md:py-10">
          <div class="mx-auto max-w-3xl">
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
          </div>
        </main>
      </div>
    </div>
  )
}
