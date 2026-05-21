import { Collapsible } from "@kobalte/core/collapsible"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { motion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// DemoSource — Kobalte Collapsible wraps the source viewer so the trigger
// + content stay accessible (aria-expanded, keyboard activation, paired
// data attributes for animation), while the chevron rotation is driven by
// motion. CSS handles the height animation via Kobalte's exposed
// `--kb-collapsible-content-height` variable (see app.css).
//
// Source loading stays lazy: shiki is only fetched once `open` flips true.
// The source loader itself is also a function so the demo's raw .tsx
// import is deferred until the user actually expands the block.
//
// Reactivity contract: when the surrounding route changes, AppShell hands
// us a new `source` loader. We discard the prior highlight + re-fetch if
// currently open, and cancel any in-flight previous request.
// ---------------------------------------------------------------------------

export type DemoSourceProps = {
  source: () => Promise<string>
  /** Optional filename for the header. Defaults to "View source". */
  filename?: string
}

export function DemoSource(props: DemoSourceProps) {
  const [html, setHtml] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [open, setOpen] = createSignal(false)

  createEffect(() => {
    const loader = props.source
    const isOpen = open()

    // Source changed → always discard the prior highlight (stale code).
    setHtml(null)
    setError(null)

    if (!isOpen) {
      setLoading(false)
      return
    }

    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })

    setLoading(true)
    void (async () => {
      try {
        // Fine-grained bundle: pull ONLY the tsx grammar + github-light
        // theme. The shorthand `import "shiki"` ships every grammar and
        // theme (and WASM oniguruma), ballooning the lazy chunk to ~600KB+.
        // The JS regex engine avoids the WASM blob entirely.
        const [source, { createHighlighterCore }, { createJavaScriptRegexEngine }] =
          await Promise.all([
            loader(),
            import("shiki/core"),
            import("shiki/engine/javascript"),
          ])
        if (cancelled) return
        const highlighter = await createHighlighterCore({
          // Dual-theme load: Shiki emits inline-style CSS variables for
          // BOTH light + dark variants in the same output. The active
          // theme is selected by the `@media (prefers-color-scheme:
          // dark)` rule in app.css — no JS toggle needed.
          themes: [
            import("shiki/themes/github-light.mjs"),
            import("shiki/themes/github-dark.mjs"),
          ],
          langs: [import("shiki/langs/tsx.mjs")],
          engine: createJavaScriptRegexEngine(),
        })
        if (cancelled) return
        const rendered = highlighter.codeToHtml(source, {
          lang: "tsx",
          themes: {
            light: "github-light",
            dark: "github-dark",
          },
        })
        if (cancelled) return
        setHtml(rendered)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
  })

  return (
    <Collapsible
      open={open()}
      onOpenChange={setOpen}
      class="mt-10 border-t border-border pt-5"
    >
      <Collapsible.Trigger class="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-sm font-semibold tracking-wide text-fg/85 hover:text-fg focus-visible:outline-2 focus-visible:outline-primary">
        {/*
          The label tucks down ~3px and back to 0 on open — a small
          "the content arrived" beat that reinforces the chevron flip
          and the height expansion. Keyframe array [-3, 0] means motion
          plays through both stops; when `open` toggles back to false
          the value just lands at 0 instantly (no spring back). Same
          easing as the chevron rotate so the two move together.
        */}
        <motion.span
          animate={{ y: open() ? [-3, 0] : 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        >
          {props.filename ?? "View source"}
        </motion.span>
        <motion.svg
          viewBox="0 0 20 20"
          class="h-4 w-4 text-muted"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          animate={{ rotate: open() ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <path d="M5 8l5 5 5-5" stroke-linecap="round" stroke-linejoin="round" />
        </motion.svg>
      </Collapsible.Trigger>
      <Collapsible.Content class="kb-collapsible-animated overflow-hidden">
        <div class="mt-3 overflow-hidden rounded-lg border border-border text-sm leading-relaxed">
          <Show
            when={!loading() && !error() && html()}
            fallback={<Placeholder loading={loading()} error={error()} />}
          >
            {/* Shiki's HTML is trusted output we generated ourselves from
               the demo source — safe for Solid's `innerHTML` prop. */}
            <div innerHTML={html() ?? ""} class="max-h-[560px] overflow-y-auto" />
          </Show>
        </div>
      </Collapsible.Content>
    </Collapsible>
  )
}

function Placeholder(props: { loading: boolean; error: string | null }) {
  return (
    <div class="bg-surface p-4 font-mono text-sm text-muted">
      {props.error
        ? `couldn't load source: ${props.error}`
        : props.loading
          ? "loading source…"
          : ""}
    </div>
  )
}
