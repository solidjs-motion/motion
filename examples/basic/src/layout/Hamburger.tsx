import { motion } from "solidjs-motion"

// ---------------------------------------------------------------------------
// Two-line hamburger that morphs into an X. Drives both bars off a shared
// variant name (`closed` | `open`); the drawer state controls which one is
// active via the `state` prop.
//
// Why explicit `top` positions instead of Tailwind's `-translate-y-1/2`
// centering: motion writes the element's `transform` (translate3d + rotate)
// for the animation, which would clobber a CSS `translateY(-50%)`. By
// positioning each bar with `top: Npx` and letting motion own `transform`
// entirely, the two systems don't fight.
//
// Container is 16px tall (h-4). Bars at top=5 and top=9 sit 4px apart in
// the closed state. The open state translates each bar by ±2px toward
// y=7 (container midline) and rotates ±45° to form an X.
// ---------------------------------------------------------------------------

const topBar = {
  closed: { y: 0, rotate: 0 },
  open: { y: 2, rotate: 45 },
}

const bottomBar = {
  closed: { y: 0, rotate: 0 },
  open: { y: -2, rotate: -45 },
}

export type HamburgerProps = {
  state: "closed" | "open"
}

export function Hamburger(props: HamburgerProps) {
  return (
    <span class="relative inline-block h-4 w-5" aria-hidden="true">
      <motion.span
        class="absolute left-0 top-[5px] block h-[2px] w-full rounded bg-current"
        animate={props.state}
        variants={topBar}
        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      />
      <motion.span
        class="absolute left-0 top-[9px] block h-[2px] w-full rounded bg-current"
        animate={props.state}
        variants={bottomBar}
        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      />
    </span>
  )
}
