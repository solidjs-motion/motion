import { fireEvent, render } from "@solidjs/testing-library"
import { For, createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// <Reorder.Group> + <Reorder.Item> — JSX wrappers around createReorder.
// Three suites:
//   1. component shape — default tags, `as` override, DOM prop pass-through,
//      Item-without-Group error.
//   2. handle — dragControls + dragListener: false routing from a child
//      element (the "handle" pattern).
//   3. integration — full drag flow through the component layer produces
//      the same setValues behavior the primitive tests verify.
//
// Mock layer mirrors createReorder.test.tsx + drag-suppression.test.tsx
// (HTMLVisualElement / visualElementStore / time / animate spy).
// ---------------------------------------------------------------------------

const { animateSpy, captured, resetCaptured, timeMock } = vi.hoisted(() => {
  type Write = { name: string; value: number }
  const captured: { writes: Write[]; veCreated: number } = { writes: [], veCreated: 0 }

  const animateSpy = vi.fn((..._args: unknown[]) => ({
    stop: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    cancel: vi.fn(),
    complete: vi.fn(),
    // biome-ignore lint/suspicious/noThenProperty: motion's AnimationPlaybackControls is intentionally thenable
    then: (resolve: () => void) => {
      resolve()
      return Promise.resolve()
    },
  }))

  function resetCaptured() {
    captured.writes = []
    captured.veCreated = 0
  }

  const timeMock = { now: vi.fn(() => 0) }
  return { animateSpy, captured, resetCaptured, timeMock }
})

vi.mock("motion", async () => {
  const actual = await vi.importActual<typeof import("motion")>("motion")
  return { ...actual, animate: animateSpy }
})

vi.mock("motion-dom", async () => {
  const actual = await vi.importActual<typeof import("motion-dom")>("motion-dom")

  type MockMV = {
    _name: string
    _value: number
    get: () => number
    set: (v: number) => void
    stop: () => void
    on: () => () => void
    getVelocity: () => number
  }

  function makeMockMV(name: string, initial: number): MockMV {
    const mv: MockMV = {
      _name: name,
      _value: initial,
      get: () => mv._value,
      set: vi.fn((v: number) => {
        mv._value = v
        captured.writes.push({ name, value: v })
      }),
      stop: vi.fn(),
      on: () => () => {},
      getVelocity: () => 0,
    }
    return mv
  }

  class MockHTMLVisualElement {
    private mvs = new Map<string, MockMV>()
    constructor() {
      captured.veCreated++
    }
    mount(_el: HTMLElement): void {}
    getValue(name: string, initial: number): MockMV {
      let mv = this.mvs.get(name)
      if (!mv) {
        mv = makeMockMV(name, initial)
        this.mvs.set(name, mv)
      }
      return mv
    }
  }

  return {
    ...actual,
    HTMLVisualElement: MockHTMLVisualElement,
    visualElementStore: new WeakMap(),
    time: timeMock,
  }
})

const { Reorder } = await import("../../src/reorder")
const { createDragControls } = await import("../../src/primitives/createDragControls")

// ---------------------------------------------------------------------------
// Shared infra
// ---------------------------------------------------------------------------

const stubRect = (
  el: Element,
  rect: { x: number; y: number; width: number; height: number },
): void => {
  el.getBoundingClientRect = () => new DOMRect(rect.x, rect.y, rect.width, rect.height)
}

let originalDocElementRect: () => DOMRect

beforeEach(() => {
  originalDocElementRect = document.documentElement.getBoundingClientRect.bind(
    document.documentElement,
  )
  stubRect(document.documentElement, { x: 0, y: 0, width: 1000, height: 1000 })
  animateSpy.mockClear()
  resetCaptured()
  timeMock.now.mockReset()
  timeMock.now.mockReturnValue(0)
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  document.documentElement.getBoundingClientRect = originalDocElementRect
  delete (window as Partial<Window>).matchMedia
})

function drag(
  el: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  fireEvent.pointerDown(el, {
    pointerId: 1,
    clientX: from.x,
    clientY: from.y,
    isPrimary: true,
  })
  fireEvent.pointerMove(window, {
    pointerId: 1,
    clientX: from.x + (to.x === from.x ? 0 : 4),
    clientY: from.y + (to.y === from.y ? 0 : 4),
    isPrimary: true,
  })
  fireEvent.pointerMove(window, {
    pointerId: 1,
    clientX: to.x,
    clientY: to.y,
    isPrimary: true,
  })
  fireEvent.pointerUp(window, {
    pointerId: 1,
    clientX: to.x,
    clientY: to.y,
    isPrimary: true,
  })
}

// ---------------------------------------------------------------------------
// Suite 1 — component shape
// ---------------------------------------------------------------------------

describe("<Reorder.Group> / <Reorder.Item> — shape", () => {
  it("Group renders a <ul> by default; Item renders a <li>", () => {
    const [items, setItems] = createSignal(["a", "b"])
    const { container } = render(() => (
      <Reorder.Group values={items} onReorder={setItems}>
        <For each={items()}>
          {(v) => (
            <Reorder.Item value={v} data-testid={`it-${v}`}>
              {v}
            </Reorder.Item>
          )}
        </For>
      </Reorder.Group>
    ))
    const list = container.querySelector("ul")
    expect(list).not.toBeNull()
    const items_ = container.querySelectorAll("li")
    expect(items_.length).toBe(2)
    expect(items_[0]?.textContent).toBe("a")
    expect(items_[1]?.textContent).toBe("b")
  })

  it("Group respects `as` override (ol); Item respects `as` override (div)", () => {
    const [items, setItems] = createSignal(["x"])
    const { container } = render(() => (
      <Reorder.Group as="ol" values={items} onReorder={setItems}>
        <For each={items()}>
          {(v) => (
            <Reorder.Item as="div" value={v}>
              {v}
            </Reorder.Item>
          )}
        </For>
      </Reorder.Group>
    ))
    expect(container.querySelector("ol")).not.toBeNull()
    expect(container.querySelector("ul")).toBeNull()
    expect(container.querySelector("ol > div")).not.toBeNull()
    expect(container.querySelector("li")).toBeNull()
  })

  it("Group passes DOM props through to its container element", () => {
    const [items, setItems] = createSignal<string[]>([])
    const { container } = render(() => (
      <Reorder.Group
        values={items}
        onReorder={setItems}
        class="grouped"
        data-testid="g"
        id="group-id"
      >
        <For each={items()}>{(v) => <Reorder.Item value={v}>{v}</Reorder.Item>}</For>
      </Reorder.Group>
    ))
    const list = container.querySelector<HTMLUListElement>("ul")
    expect(list?.getAttribute("class")).toBe("grouped")
    expect(list?.id).toBe("group-id")
    expect(list?.dataset.testid).toBe("g")
  })

  it("Item passes DOM props through to its element", () => {
    const [items, setItems] = createSignal(["only"])
    const { container } = render(() => (
      <Reorder.Group values={items} onReorder={setItems}>
        <For each={items()}>
          {(v) => (
            <Reorder.Item
              value={v}
              class="row"
              id={`row-${v}`}
              data-testid={`row-${v}`}
            >
              {v}
            </Reorder.Item>
          )}
        </For>
      </Reorder.Group>
    ))
    const li = container.querySelector<HTMLLIElement>("li")
    expect(li?.getAttribute("class")).toBe("row")
    expect(li?.id).toBe("row-only")
    expect(li?.dataset.testid).toBe("row-only")
  })

  it("Item throws a useful error when rendered outside a Group", () => {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: deliberate console silencer
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() =>
      render(() => (
        <Reorder.Item value="orphan" data-testid="orphan">
          orphan
        </Reorder.Item>
      )),
    ).toThrow(/<Reorder\.Item> must be a descendant of <Reorder\.Group>/)
    consoleError.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Suite 2 — drag handle composition (dragControls + dragListener: false)
// ---------------------------------------------------------------------------

describe("<Reorder.Item> — drag handle", () => {
  it("a drag started via dragControls.start triggers center-cross", () => {
    const onReorderCalls: string[][] = []
    const [items, setItems] = createSignal(["a", "b", "c"])
    const controlsByValue = new Map<string, ReturnType<typeof createDragControls>>()

    const { container } = render(() => (
      <Reorder.Group
        values={items}
        onReorder={(updater) => {
          const next =
            typeof updater === "function"
              ? (updater as (prev: string[]) => string[])(items())
              : updater
          onReorderCalls.push(next)
          setItems(next)
          return next
        }}
      >
        <For each={items()}>
          {(v) => {
            const controls = createDragControls()
            controlsByValue.set(v, controls)
            return (
              <Reorder.Item
                value={v}
                dragListener={false}
                dragControls={controls}
                data-testid={`it-${v}`}
              >
                <button
                  data-testid={`h-${v}`}
                  type="button"
                  onPointerDown={(e) => controls.start(e)}
                >
                  ⋮
                </button>
                {v}
              </Reorder.Item>
            )
          }}
        </For>
      </Reorder.Group>
    ))

    // Layout: contiguous 100-height items.
    for (let i = 0; i < 3; i++) {
      const v = items()[i] as string
      const el = container.querySelector<HTMLElement>(`[data-testid='it-${v}']`)
      if (el === null) continue
      stubRect(el, { x: 0, y: i * 100, width: 100, height: 100 })
    }

    // Trigger drag via the handle's pointerdown — the handle calls
    // controls.start(event) which kicks the drag pipeline through the
    // item element. Subsequent moves must still happen on window because
    // motion-dom captured the pointer.
    const handle = container.querySelector<HTMLButtonElement>("[data-testid='h-a']")
    if (handle === null) throw new Error("handle not found")
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      clientX: 50,
      clientY: 50,
      isPrimary: true,
    })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY: 54, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY: 160, isPrimary: true })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 50, clientY: 160, isPrimary: true })

    expect(onReorderCalls).toEqual([["b", "a", "c"]])
    expect(items()).toEqual(["b", "a", "c"])
  })

  it("dragListener: false alone disables whole-item drag (no swaps from item body)", () => {
    const onReorderCalls: string[][] = []
    const [items, setItems] = createSignal(["a", "b", "c"])

    const { container } = render(() => (
      <Reorder.Group
        values={items}
        onReorder={(updater) => {
          const next =
            typeof updater === "function"
              ? (updater as (prev: string[]) => string[])(items())
              : updater
          onReorderCalls.push(next)
          setItems(next)
          return next
        }}
      >
        <For each={items()}>
          {(v) => (
            <Reorder.Item value={v} dragListener={false} data-testid={`it-${v}`}>
              {v}
            </Reorder.Item>
          )}
        </For>
      </Reorder.Group>
    ))

    for (let i = 0; i < 3; i++) {
      const v = items()[i] as string
      const el = container.querySelector<HTMLElement>(`[data-testid='it-${v}']`)
      if (el === null) continue
      stubRect(el, { x: 0, y: i * 100, width: 100, height: 100 })
    }

    const itemA = container.querySelector<HTMLElement>("[data-testid='it-a']")
    if (itemA === null) throw new Error("item not found")
    drag(itemA, { x: 50, y: 50 }, { x: 50, y: 160 })

    // No drag listener on the item, no dragControls → no drag, no swaps.
    expect(onReorderCalls).toEqual([])
    expect(items()).toEqual(["a", "b", "c"])
  })
})

// ---------------------------------------------------------------------------
// Suite 3 — integration (component layer routes drag through to primitive)
// ---------------------------------------------------------------------------

describe("<Reorder.*> — integration with createReorder", () => {
  it("dragging an item via the component flow mutates values", () => {
    const [items, setItems] = createSignal(["a", "b", "c"])
    const { container } = render(() => (
      <Reorder.Group values={items} onReorder={setItems}>
        <For each={items()}>
          {(v) => (
            <Reorder.Item value={v} data-testid={`it-${v}`}>
              {v}
            </Reorder.Item>
          )}
        </For>
      </Reorder.Group>
    ))
    for (let i = 0; i < 3; i++) {
      const v = items()[i] as string
      const el = container.querySelector<HTMLElement>(`[data-testid='it-${v}']`)
      if (el === null) continue
      stubRect(el, { x: 0, y: i * 100, width: 100, height: 100 })
    }
    const itemA = container.querySelector<HTMLElement>("[data-testid='it-a']")
    if (itemA === null) throw new Error("item not found")
    drag(itemA, { x: 50, y: 50 }, { x: 50, y: 160 })
    expect(items()).toEqual(["b", "a", "c"])
  })

  it("Group's `axis` prop flows into the primitive's drag config", () => {
    const [items, setItems] = createSignal(["a", "b", "c"])
    const { container } = render(() => (
      <Reorder.Group axis="x" values={items} onReorder={setItems}>
        <For each={items()}>
          {(v) => (
            <Reorder.Item value={v} data-testid={`it-${v}`}>
              {v}
            </Reorder.Item>
          )}
        </For>
      </Reorder.Group>
    ))
    // Stub layout along x.
    for (let i = 0; i < 3; i++) {
      const v = items()[i] as string
      const el = container.querySelector<HTMLElement>(`[data-testid='it-${v}']`)
      if (el === null) continue
      stubRect(el, { x: i * 100, y: 0, width: 100, height: 100 })
    }
    const itemA = container.querySelector<HTMLElement>("[data-testid='it-a']")
    if (itemA === null) throw new Error("item not found")
    drag(itemA, { x: 50, y: 50 }, { x: 170, y: 50 })
    expect(items()).toEqual(["b", "a", "c"])
  })

  it("Group's `cancelOnExternalReorder` flows into the primitive", () => {
    // We can verify it by triggering an external mutation during a drag and
    // observing the abort. Same pattern as the primitive's edge-case test.
    let externalSet!: (next: string[]) => void
    const { container } = render(() => {
      const [items, setItems] = createSignal(["a", "b", "c"])
      externalSet = (next) => setItems(next)
      return (
        <Reorder.Group
          values={items}
          onReorder={setItems}
          cancelOnExternalReorder={true}
        >
          <For each={items()}>
            {(v) => (
              <Reorder.Item value={v} data-testid={`it-${v}`}>
                {v}
              </Reorder.Item>
            )}
          </For>
        </Reorder.Group>
      )
    })
    for (let i = 0; i < 3; i++) {
      const v = ["a", "b", "c"][i] as string
      const el = container.querySelector<HTMLElement>(`[data-testid='it-${v}']`)
      if (el === null) continue
      stubRect(el, { x: 0, y: i * 100, width: 100, height: 100 })
    }
    const itemB = container.querySelector<HTMLElement>("[data-testid='it-b']")
    if (itemB === null) throw new Error("item not found")
    // Start a drag on b (don't release).
    fireEvent.pointerDown(itemB, {
      pointerId: 1,
      clientX: 50,
      clientY: 150,
      isPrimary: true,
    })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY: 154, isPrimary: true })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY: 160, isPrimary: true })

    // External mutation under strict mode should abort the drag — visible
    // via no subsequent reorder mutating items. We don't have direct
    // access to `dragging` here (the primitive is internal), but we can
    // verify the drag aborted by trying to swap after the external write
    // and seeing nothing happens.
    externalSet(["c", "b", "a"])
    // The drag should now be aborted. A further pointermove that WOULD
    // have crossed centers does nothing because the drag is over.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY: 500, isPrimary: true })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 50, clientY: 500, isPrimary: true })

    // After the external write the array is whatever the external mutation
    // set it to (no further mutations from the drag).
    const list = container.querySelectorAll<HTMLLIElement>("[data-testid^='it-']")
    expect([...list].map((n) => n.textContent)).toEqual(["c", "b", "a"])
  })
})
