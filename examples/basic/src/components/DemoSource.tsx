import { createEffect, createSignal, onCleanup, Show } from "solid-js"

// ---------------------------------------------------------------------------
// DemoSource — renders the source of the current demo inside a collapsible
// <details> block. Highlights with Shiki, but Shiki is dynamic-imported only
// when the user expands the block (or on the first render when already open
// after a navigation) — keeps the initial page bundle lean.
//
// The `source` prop is a loader function (not a static string) so each
// demo's source file is itself only fetched on expansion. Pairs with the
// registry's `() => import("./Demo.tsx?raw")` pattern.
//
// Reactivity contract: when the surrounding route changes, AppShell hands
// us a new `source` loader (pointing at the new demo's file). We must:
//   1. Throw away the previously-highlighted HTML — otherwise the user
//      navigates to demo B and still sees demo A's code.
//   2. If the <details> is currently open, immediately re-fetch and
//      re-highlight the new source.
//   3. Cancel any in-flight highlight from the previous source so a slow
//      response can't overwrite the new one.
//
// We treat <details> as uncontrolled: the browser owns its open state. An
// `open` signal mirrors that state for the effect below, set via onToggle.
// Persists across navigations naturally (the DOM element is reused), which
// is the behavior you want — open stays open as you browse.
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

  // Re-runs whenever the `source` loader OR `open` signal changes. Solid's
  // iteration-scoped onCleanup flips a cancelled flag so a previous run's
  // async work can't write into the new run's signals.
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
          themes: [import("shiki/themes/github-light.mjs")],
          langs: [import("shiki/langs/tsx.mjs")],
          engine: createJavaScriptRegexEngine(),
        })
        if (cancelled) return
        const rendered = highlighter.codeToHtml(source, {
          lang: "tsx",
          theme: "github-light",
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
    <details
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      style={{
        "margin-top": "2.5rem",
        "border-top": "1px solid #eee",
        "padding-top": "1.25rem",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          "user-select": "none",
          "font-size": "0.85rem",
          "font-weight": 600,
          color: "#555",
          "letter-spacing": "0.02em",
        }}
      >
        {props.filename ?? "View source"}
      </summary>
      <div
        style={{
          "margin-top": "0.75rem",
          "border-radius": "8px",
          overflow: "hidden",
          border: "1px solid #eee",
          "font-size": "0.8rem",
          "line-height": 1.5,
        }}
      >
        <Show
          when={!loading() && !error() && html()}
          fallback={<Placeholder loading={loading()} error={error()} />}
        >
          {/* Shiki's HTML is trusted output we generated ourselves from
             the demo source — safe for Solid's `innerHTML` prop. */}
          <div innerHTML={html() ?? ""} style={{ "max-height": "560px", "overflow-y": "auto" }} />
        </Show>
      </div>
    </details>
  )
}

function Placeholder(props: { loading: boolean; error: string | null }) {
  return (
    <div
      style={{
        padding: "1rem",
        background: "#fafafa",
        color: "#777",
        "font-family": "ui-monospace, monospace",
        "font-size": "0.8rem",
      }}
    >
      {props.error
        ? `couldn't load source: ${props.error}`
        : props.loading
          ? "loading source…"
          : ""}
    </div>
  )
}
