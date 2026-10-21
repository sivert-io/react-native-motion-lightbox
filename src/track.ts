import { useEffect, useMemo, useRef, useState } from 'react'
import { Gesture } from 'react-native-gesture-handler'
import { Easing, cancelAnimation, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

/** Space between pictures on the track, in points. */
export const GAP = 12

// Eased at both ends for a move asked for (an arrow, autoplay, a thumbnail).
// A released drag springs instead, carrying on at the speed the finger let go at.
const GLIDE = { duration: 560, easing: Easing.bezier(0.65, 0, 0.35, 1) }
const SPRING = { stiffness: 260, damping: 34 }

/**
 * A row of pictures, one `step` apart, that moves as one: drag it, flick it,
 * grab it mid-glide. Shared by the gallery and the lightbox.
 *
 * Positions are absolute: picture `i` sits at `i * step + x`, so the current
 * one is in place when `x` is `-index * step`. The web package re-bases `x` on
 * every picture instead, and a picture joining mid-move kept missing that.
 * It doesn't wrap round from the last picture to the first, as photo apps on
 * a phone don't.
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

  /**
   * To a picture: a glide to a neighbour, straight there for one further
   * away (only the neighbours are drawn, so a long glide would pass through
   * nothing) or with reduced motion.
   */
  const show = (to: number) => {
    const { index, step, count, reduced } = latest.current
    const target = Math.max(0, Math.min(count - 1, to))
    setIndex(target)
    if (reduced || Math.abs(target - index) > 1) {
      cancelAnimation(x)
      x.value = -target * step
    } else {
      x.value = withTiming(-target * step, GLIDE)
    }
  }
  const go = (dir: 1 | -1) => show(latest.current.index + dir)
  /** Straight to a picture, no move: the gallery landing where the lightbox closed. */
  const jump = (to: number) => {
    cancelAnimation(x)
    x.value = -to * latest.current.step
    setIndex(to)
  }

  // On the UI thread, for gestures. A drag takes the track over wherever it
  // is; past either end it gives a third as much. Let go, and it lands on the
  // picture it would coast to at that speed.
  const max = (count - 1) * step
  const begin = () => {
    'worklet'
    cancelAnimation(x)
    from.value = x.value
  }
  const move = (dx: number) => {
    'worklet'
    const at = from.value + dx
    x.value = at > 0 ? at / 3 : at < -max ? -max + (at + max) / 3 : at
  }
  const settle = (velocity: number) => {
    'worklet'
    // One picture at most: only the neighbours are drawn.
    const coast = step ? Math.round(-(x.value + velocity * 0.2) / step) : index
    const target = Math.max(0, Math.min(count - 1, Math.max(index - 1, Math.min(index + 1, coast))))
    x.value = reduced ? -target * step : withSpring(-target * step, { ...SPRING, velocity })
    scheduleOnRN(setIndex, target)
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
