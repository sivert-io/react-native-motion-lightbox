import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { cropOf, fitIn } from './crop'
import { DEFAULT_COLORS, DEFAULT_LABELS, Lightbox, useNaturalSizes } from './Lightbox'
import { GAP, offsetOf, useTrack, wrap as loop } from './track'
import type { Crop, LightboxItem, LightboxProps, Rect } from './types'

export interface GalleryProps<T extends LightboxItem = LightboxItem>
  extends Omit<LightboxProps<T>, 'index' | 'open' | 'onClose' | 'onExited' | 'origin' | 'originCrop'> {
  /** A picture's width over its height. Default 1, a square. */
  aspect?: number
  /**
   * `'cover'`, the default, fills the box with the part of each picture its
   * `focus` and `zoom` pick. `'contain'` shows the whole picture inside the box.
   */
  fit?: 'cover' | 'contain'
  /** How many points of the next picture show at the right edge, so it reads as something to swipe. Default 0. */
  peek?: number
  /** The space between pictures, in points. Default 12. */
  gap?: number
  /** Called with the picture's index on a tap, instead of opening the lightbox: for an app with a viewer of its own. */
  onPress?: (index: number) => void
  /** Called with the picture's index on a long press. */
  onLongPress?: (index: number) => void
  /**
   * Move on by itself every this many milliseconds, like a slideshow. Off by
   * default. It holds while a finger is on it or the lightbox is open, there's
   * a button to pause it, and it stays still with reduced motion.
   */
  autoplay?: number
  style?: StyleProp<ViewStyle>
}

/**
 * A small lightbox for a message or a feed: one picture at a time in a box,
 * on the same track as the lightbox. Swipe it, and tap a picture to open the
 * lightbox out of it. A mostly vertical swipe is left to the screen, so a
 * list around it still scrolls. Takes the lightbox's props and passes them on.
 */
export function Gallery<T extends LightboxItem>({
  aspect = 1,
  fit = 'cover',
  peek = 0,
  gap = GAP,
  onPress,
  onLongPress,
  autoplay,
  style,
  ...props
}: GalleryProps<T>) {
  const { items, caption, onIndexChange, renderVideo, radius = 12 } = props
  const labels = { ...DEFAULT_LABELS, ...props.labels }
  const colors = { ...DEFAULT_COLORS, ...props.colors }
  const n = items.length
  const many = n > 1
  const natural = useNaturalSizes(items)

  // Every picture is the same size, the box less the peek, so a neighbour is
  // one picture and a gap away.
  const [width, setWidth] = useState(0)
  const slideWidth = Math.max(0, width - peek)
  const height = slideWidth / aspect
  const step = slideWidth + gap
  const track = useTrack({ count: n, step })
  const { index, x } = track
  const latest = useRef(index)
  useEffect(() => {
    latest.current = index
  })
  const shown = useRef(index)
  useEffect(() => {
    if (index === shown.current) return
    shown.current = index
    onIndexChange?.(index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  const crop = (i: number): Crop => cropOf({ ...items[i], ...natural(items[i]) }, aspect)
  const [open, setOpen] = useState(false)

  // A tap opens the picture on screen; a swipe never counts as one, because
  // the pan wins the race as soon as the finger has moved.
  const press = () => (onPress ? onPress(latest.current) : setOpen(true))
  const longPress = () => onLongPress?.(latest.current)
  // Built once (per track), not on every render: a gesture swapped out while
  // a finger is down loses that touch, and the first tap went nowhere.
  const handlers = useRef({ press, longPress })
  useEffect(() => {
    handlers.current = { press, longPress }
  })
  const [onTap] = useState(() => () => handlers.current.press())
  const [onHold] = useState(() => () => handlers.current.longPress())
  const holds = Boolean(onLongPress)
  const gesture = useMemo(() => {
    const tap = Gesture.Tap()
      .maxDistance(10)
      .onEnd((_e, success) => {
        if (success) scheduleOnRN(onTap)
      })
    const hold = Gesture.LongPress()
      .minDuration(450)
      .onStart(() => scheduleOnRN(onHold))
    return holds ? Gesture.Race(track.pan, hold, tap) : Gesture.Race(track.pan, tap)
  }, [track.pan, holds, onTap, onHold])

  // The slideshow. Held while a finger is on it, so it never moves out from
  // under someone, and paused for good with the button (WCAG 2.2.2).
  const [held, setHeld] = useState(false)
  const [paused, setPaused] = useState(false)
  const playing = Boolean(autoplay) && many && !paused
  useEffect(() => {
    if (!playing || held || open || track.reduced) return
    const timer = setTimeout(() => track.show((latest.current + 1) % n), autoplay)
    return () => clearTimeout(timer)
    // Restarts on every move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, held, open, index, track.reduced])

  // The lightbox opens out of the box. It follows the lightbox underneath, so
  // by the time it closes, the picture it ended on is the one in the box.
  const box = useRef<View>(null)
  const origin = (i: number) =>
    new Promise<Rect | undefined>((resolve) =>
      // A frame first, for the gallery to land on the lightbox's picture.
      requestAnimationFrame(() => {
        if (!box.current) return resolve(undefined)
        box.current.measureInWindow((bx, by, w, h) => {
          if (!w) return resolve(undefined)
          const slide = { x: bx, y: by, width: slideWidth, height: h }
          const size = natural(items[i])
          resolve(fit === 'contain' ? fitIn(slide, size.width, size.height) : slide)
        })
      }),
    )

  const onAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName
    if (name === 'increment') track.go(1)
    else if (name === 'decrement') track.go(-1)
    else if (name === 'activate') press()
    else if (name === 'longpress') longPress()
  }

  // The current picture and its neighbours, round the loop; with a peek, the
  // one after next too, so it's there as the next one slides in. With two,
  // that's the one on the other side as well, so each is drawn twice.
  const window = [...new Set([index - 1, index, index + 1, ...(peek > 0 ? [index + 2] : [])].map((i) => loop(i, n)))]
  const slides = [...window.map((i) => ({ i, copy: false })), ...(n === 2 && peek > 0 ? window.map((i) => ({ i, copy: true })) : [])]
  const item = items[index]

  return (
    <View
      style={style}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      // Only with a slideshow to hold: otherwise a touch needn't re-render.
      onTouchStart={autoplay ? () => setHeld(true) : undefined}
      onTouchEnd={autoplay ? () => setHeld(false) : undefined}
      onTouchCancel={autoplay ? () => setHeld(false) : undefined}
    >
      <GestureDetector gesture={gesture}>
        <View
          ref={box}
          collapsable={false}
          style={[styles.box, width ? { height } : { aspectRatio: aspect }]}
          accessible
          accessibilityRole={many ? 'adjustable' : 'imagebutton'}
          accessibilityLabel={item?.alt}
          accessibilityValue={many ? { text: `${index + 1} / ${n}` } : undefined}
          accessibilityActions={[
            ...(many ? [{ name: 'increment', label: labels.next }, { name: 'decrement', label: labels.previous }] : []),
            { name: 'activate' },
            ...(onLongPress ? [{ name: 'longpress' }] : []),
          ]}
          onAccessibilityAction={onAction}
        >
          {width > 0 &&
            slides.map(({ i, copy }) => (
              <Slide
                key={copy ? `${i}:copy` : i}
                item={items[i]}
                i={i}
                n={n}
                copy={copy}
                x={x}
                step={step}
                width={slideWidth}
                height={height}
                radius={radius}
                background={colors.slide}
                crop={fit === 'cover' ? crop(i) : undefined}
                video={renderVideo && items[i].kind === 'video' ? renderVideo(items[i], { active: i === index }) : undefined}
              />
            ))}
        </View>
      </GestureDetector>

      {(caption || many) && (
        <View style={[styles.foot, { paddingRight: peek }]}>
          <View style={styles.caption}>{wrap(caption?.(item, index), colors.muted)}</View>
          {many && <Text style={[styles.count, { color: colors.muted }]}>{`${index + 1} / ${n}`}</Text>}
          {autoplay ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={paused ? labels.play : labels.pause}
              onPress={() => setPaused((was) => !was)}
              hitSlop={10}
            >
              {(paused ? props.icons?.play : props.icons?.pause) ?? (
                <Text style={[styles.count, { color: colors.muted }]}>{paused ? '▶' : '❚❚'}</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      )}

      {!onPress && (
        <Lightbox
          {...props}
          index={index}
          open={open}
          onClose={() => setOpen(false)}
          onIndexChange={track.jump}
          origin={origin}
          originCrop={fit === 'cover' ? crop : undefined}
        />
      )}
    </View>
  )
}

function wrap(node: ReactNode, color: string) {
  return typeof node === 'string' || typeof node === 'number' ? (
    <Text style={[styles.text, { color }]} numberOfLines={2}>
      {node}
    </Text>
  ) : (
    node
  )
}

/** One picture in the box: the whole of it, placed so the box shows just its crop, or fitted inside. */
function Slide({
  item,
  i,
  n,
  x,
  step,
  width,
  height,
  radius,
  background,
  crop,
  video,
  copy,
}: {
  item: LightboxItem
  i: number
  n: number
  /** Drawn a whole loop away, on the other side of the box. */
  copy: boolean
  x: SharedValue<number>
  step: number
  width: number
  height: number
  radius: number
  background: string
  crop?: Crop
  video?: ReactNode
}) {
  const along = useAnimatedStyle(() => {
    const at = offsetOf(i, -x.value / (step || 1), n)
    return { transform: [{ translateX: (copy ? at - Math.sign(at || 1) * n : at) * step }] }
  })
  const uri = item.kind === 'image' ? item.src : (item.poster ?? item.src)
  return (
    <Animated.View style={[styles.slide, { width, height, borderRadius: radius, backgroundColor: background }, along]}>
      {video ? (
        <View style={StyleSheet.absoluteFill}>{video}</View>
      ) : crop ? (
        <Image
          source={{ uri }}
          style={{
            position: 'absolute',
            width: width / crop[2],
            height: height / crop[3],
            left: (-crop[0] / crop[2]) * width,
            top: (-crop[1] / crop[3]) * height,
          }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityIgnoresInvertColors />
      )}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
  slide: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  caption: { flex: 1, minWidth: 0 },
  text: { fontSize: 13, lineHeight: 18 },
  count: { fontSize: 12, fontVariant: ['tabular-nums'] },
})
