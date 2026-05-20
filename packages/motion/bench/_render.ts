// Bench-local render helper.
//
// @solidjs/testing-library ships pre-compiled JS that imports
// `solid-js/web`. Under `vitest bench`, vite-plugin-solid does NOT inject
// the `browser` resolve condition (it gates that on `mode === "test"`),
// so testing-library's pre-compiled module ends up bound to the server
// build of `solid-js/web` and its `render` throws "Client-only API called
// on the server side."
//
// Our bench .tsx files go through vite-plugin-solid's transform pipeline,
// which DOES bind them to the client `solid-js/web` build (verified). So
// importing `render` directly from `solid-js/web` inside a bench file
// gives us a working client render without testing-library in the
// dependency chain.
//
// This helper mirrors the shape we use from testing-library: returns
// `{ container, unmount }`.

import { render as solidRender } from "solid-js/web"

export function render(ui: () => unknown): {
  container: HTMLElement
  unmount: () => void
} {
  const container = document.createElement("div")
  document.body.appendChild(container)
  // biome-ignore lint/suspicious/noExplicitAny: solid-js/web's render expects JSX.Element; ui's return is structurally compatible at runtime.
  const dispose = solidRender(ui as () => any, container)
  return {
    container,
    unmount: () => {
      dispose()
      container.remove()
    },
  }
}
