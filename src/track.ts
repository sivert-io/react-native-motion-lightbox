import { useEffect, useMemo, useRef, useState } from 'react'
import { Gesture } from 'react-native-gesture-handler'
import { Easing, cancelAnimation, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

/** Space between pictures on the track, in points. */
export const GAP = 12

// Eased at both ends for a move asked for (an arrow, autoplay, a thumbnail).
// A released drag springs instead, carrying on at the speed the finger let go at.
const GLIDE = { duration: 560, easing: Easing.bezier(0.65, 0, 0.35, 1) }
// Mass 1, as in Motion: Reanimated fills in 4 when it's left out, and the
// same stiffness and damping then bounce.
const SPRING = { stiffness: 260, damping: 34, mass: 1 }

/** `i` wrapped into 0..n. */
export const wrap = (i: number, n: number) => {
  'worklet'
  return ((i % n) + n) % n
}
/** How far picture `i` is from track position `pos`, the shorter way round: -n/2 to n/2. */
export const offsetOf = (i: number, pos: number, n: number) => {
  'worklet'
  const d = i - pos
  return n > 1 ? d - n * Math.round(d / n) : d
}

/**
 * A row of pictures, one `step` apart, that moves as one: drag it, flick it,
 * grab it mid-glide. Shared by the gallery and the lightbox.
 *
 * `x` is how far the track has moved, unbounded: its position is `-x / step`
 * pictures along, and it loops, so after the last picture comes the first,
 * as on the web. Each picture is drawn at its distance from that position the
 * shorter way round (`offsetOf`). Positions are absolute, not re-based on
 * every picture as the web package's are, so a picture joining mid-move is
 * never out of step.
 */
export function useTrack({ count, step, start = 0 }: { count: number; step: number; start?: number }) {
  const [index, setIndex] = useState(start)
  const reduced = useReducedMotion()
  const x = useSharedValue(-start * step)
  const from = useSharedValue(0)
  // The latest render's values, for timers and callbacks set up in an older one.
  const latest = useRef({ index, step, count, reduced })
  useEffect(() => {
    latest.current = { index, step, count, reduced }
  })

  // A new size (the first layout, a rotation) puts the current picture back in place.
  useEffect(() => {
    cancelAnimation(x)
    x.value = -latest.current.index * step
  }, [step, x])

  /** Where the track is now, in whole pictures along it (not wrapped). */
  const here = () => Math.round(-x.value / (latest.current.step || 1))

  /**
   * To a picture, the shorter way round: a glide to a neighbour, straight
   * there for one further away (only the neighbours are drawn, so a long
   * glide would pass through nothing) or with reduced motion.
   */
  const show = (to: number) => {
    const { step, count, reduced } = latest.current
    const at = here()
    const delta = offsetOf(wrap(to, count), wrap(at, count), count)
    const target = at + delta
    setIndex(wrap(target, count))
    if (reduced || Math.abs(delta) > 1) {
      cancelAnimation(x)
      x.value = -target * step
    } else {
      x.value = withTiming(-target * step, GLIDE)
    }
  }
  const go = (dir: 1 | -1) => show(latest.current.index + dir)
  /** Straight to a picture, no move: the gallery landing where the lightbox closed. */
  const jump = (to: number) => {
    const { step, count } = latest.current
    const at = here()
    cancelAnimation(x)
    x.value = -(at + offsetOf(wrap(to, count), wrap(at, count), count)) * step
    setIndex(wrap(to, count))
  }

  // On the UI thread, for gestures. A drag takes the track over wherever it
  // is. Let go, and it lands on the neighbour it would coast to at that speed,
  // with the web package's spring and coast.
  const begin = () => {
    'worklet'
    cancelAnimation(x)
    from.value = x.value
  }
  const move = (dx: number) => {
    'worklet'
    // One picture can't loop round onto itself.
    if (count < 2) return
    x.value = from.value + dx
  }
  const settle = (velocity: number) => {
    'worklet'
    if (!step) return
    const at = Math.round(-from.value / step)
    // One picture at most either way: only the neighbours are drawn.
    const coast = Math.round(-(x.value + velocity * 0.25) / step)
    const target = count < 2 ? at : Math.max(at - 1, Math.min(at + 1, coast))
    x.value = reduced ? -target * step : withSpring(-target * step, { ...SPRING, velocity })
    scheduleOnRN(setIndex, wrap(target, count))
  }
  // Sideways only: a mostly vertical move fails it, so the screen around a
  // gallery still scrolls when a swipe starts on it.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-10, 10])
        .onBegin(begin)
        .onUpdate((e) => move(e.translationX))
        .onEnd((e) => settle(e.velocityX))
        // Touched and let go without a drag (or a scroll took over): it was
        // stopped mid-glide, so finish on the nearest picture.
        .onFinalize((_e, success) => {
          if (!success) settle(0)
        }),
    // The worklets close over these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, count, reduced, index],
  )

  return { index, x, show, go, jump, pan, begin, move, settle, reduced }
}
