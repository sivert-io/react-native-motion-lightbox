import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type AccessibilityActionEvent,
} from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { fitIn } from './crop'
import { GAP, useTrack } from './track'
import type { Crop, LightboxColors, LightboxItem, LightboxLabels, LightboxProps, Rect } from './types'

// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_LABELS: LightboxLabels = {
  dialog: 'Image viewer',
  close: 'Close',
  previous: 'Previous',
  next: 'Next',
  pause: 'Pause slideshow',
  play: 'Play slideshow',
}
export const DEFAULT_COLORS: LightboxColors = {
  backdrop: 'rgba(0, 0, 0, 0.94)',
  color: '#f4f4f5',
  muted: '#a1a1aa',
  frame: '#e0b04a',
  slide: 'rgba(127, 127, 127, 0.16)',
}

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1)
const OPEN = 500
const CLOSE = 450
const FADE = 220
const WHOLE: Crop = [0, 0, 1, 1]
/** The top bar's height, and a thumbnail's side. */
const BAR = 56
const THUMB = 48
/** A drag down this far, or flicked this fast, closes it. */
const DISMISS = 120
const DISMISS_SPEED = 900
const SPRING = { stiffness: 380, damping: 36 }

/** Each item's size: its own, or measured once it loads. */
export function useNaturalSizes(items: LightboxItem[]) {
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({})
  useEffect(() => {
    let live = true
    for (const it of items) {
      if ((it.width && it.height) || it.kind !== 'image') continue
      Image.getSize(it.src).then(
        ({ width, height }) => live && setSizes((s) => (s[it.src] ? s : { ...s, [it.src]: { width, height } })),
        () => {},
      )
    }
    return () => {
      live = false
    }
  }, [items])
  return (it: LightboxItem) =>
    it.width && it.height ? { width: it.width, height: it.height } : (sizes[it.src] ?? { width: 16, height: 9 })
}

// ── The component ───────────────────────────────────────────────────────────

/**
 * A full-screen viewer for images and videos. Opens out of the thumbnail it
 * was tapped on, moves between items on a draggable track, zooms (pinch,
 * double-tap), closes on a swipe down, and goes back into the thumbnail of
 * whatever is on screen. A transparent `Modal`, so Android's back button
 * closes it.
 */
export function Lightbox<T extends LightboxItem>(props: LightboxProps<T>) {
  const { open, index } = props
  // A session is one opening: the viewer is remounted for each.
  const [session, setSession] = useState<{ id: number; start: number } | null>(null)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open && !session) {
      setSession({ id: Date.now(), start: index })
      setClosing(false)
    } else if (!open && session) {
      setClosing(true)
    } else if (open && closing) {
      setClosing(false)
    }
    // Only open and close matter here; `index` is read at opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!session) return null
  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={props.onClose}
    >
      <GestureHandlerRootView style={styles.fill}>
        <Viewer
          key={session.id}
          {...props}
          start={session.start}
          closing={closing}
          onDone={(last) => {
            setSession(null)
            setClosing(false)
            props.onExited?.(last)
          }}
        />
      </GestureHandlerRootView>
    </Modal>
  )
}

function Viewer<T extends LightboxItem>({
  items,
  index: wanted,
  start,
  closing,
  onDone,
  onClose,
  onIndexChange,
  origin,
  originCrop,
  renderVideo,
  title,
  toolbar,
  caption,
  thumbnails = true,
  maxZoom = 8,
  radius = 12,
  labels: labelsIn,
  icons,
  colors: colorsIn,
  insets,
}: LightboxProps<T> & { start: number; closing: boolean; onDone: (index: number) => void }) {
  const labels = { ...DEFAULT_LABELS, ...labelsIn }
  const colors = { ...DEFAULT_COLORS, ...colorsIn }
  const { width: W, height: H } = useWindowDimensions()
  const pad = insets ?? (Platform.OS === 'ios' ? { top: 50, bottom: 30 } : { top: StatusBar.currentHeight ?? 24, bottom: 16 })
  const n = items.length
  const many = n > 1
  const foot = 36 + (many && thumbnails ? THUMB + 20 : 0)
  // Where pictures fit: the whole width, between the top bar and the foot.
  const stage = { x: 0, y: pad.top + BAR, width: W, height: Math.max(1, H - pad.top - BAR - pad.bottom - foot) }
  const natural = useNaturalSizes(items)
  const fitted = (i: number) => {
    const { width, height } = natural(items[i])
    return fitIn(stage, width, height)
  }

  const track = useTrack({ count: n, step: W + 2 * GAP, start })
  // Worklets take these one by one: `track` itself holds a gesture, which can't go to the UI thread.
  const { index, x, reduced, begin, move, settle } = track
  const item = items[index]
  const here = fitted(index)

  // Tell the owner where we are, and follow it when it moves us.
  const reported = useRef(start)
  useEffect(() => {
    if (index === reported.current) return
    reported.current = index
    onIndexChange?.(index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])
  useEffect(() => {
    if (wanted === reported.current || wanted < 0 || wanted >= n) return
    reported.current = wanted
    track.show(wanted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted])

  // ── The move between thumbnail and screen ────────────────────────────────
  // `p` runs from 0 on the thumbnail to 1 at rest. `fade` is for opening and
  // closing without a thumbnail. The backdrop and the bars follow both.
  const p = useSharedValue(0)
  const fade = useSharedValue(1)
  const from = useSharedValue<Rect | null>(null)
  const crop = useSharedValue<Crop>(WHOLE)
  const [ready, setReady] = useState(false)
  // True while the picture moves in or out. Every gesture and button waits:
  // one mid-move fought the move for the picture.
  const [moving, setMoving] = useState(true)

  useEffect(() => {
    let live = true
    void (async () => {
      const rect = reduced ? undefined : await origin?.(start)
      if (!live) return
      if (rect) {
        from.value = rect
        crop.value = originCrop?.(start) ?? WHOLE
        p.value = 0
        setReady(true)
        p.value = withTiming(1, { duration: OPEN, easing: EASE_OUT }, (finished) => finished && scheduleOnRN(setMoving, false))
      } else {
        p.value = 1
        fade.value = reduced ? 1 : 0
        setReady(true)
        if (reduced) setMoving(false)
        else fade.value = withTiming(1, { duration: FADE }, (finished) => finished && scheduleOnRN(setMoving, false))
      }
    })()
    return () => {
      live = false
    }
    // Once, at opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Zoom and the swipe down ──────────────────────────────────────────────
  const zs = useSharedValue(1)
  const zx = useSharedValue(0)
  const zy = useSharedValue(0)
  const dy = useSharedValue(0)
  useEffect(() => {
    zs.value = 1
    zx.value = 0
    zy.value = 0
  }, [index, zs, zx, zy])

  useEffect(() => {
    if (!closing) return
    setMoving(true)
    let live = true
    const done = () => onDone(index)
    void (async () => {
      const rect = reduced ? undefined : await origin?.(index)
      if (!live) return
      for (const v of [zs, zx, zy]) cancelAnimation(v)
      const timing = { duration: CLOSE, easing: EASE_OUT }
      zs.value = withTiming(1, timing)
      zx.value = withTiming(0, timing)
      zy.value = withTiming(0, timing)
      if (rect) {
        from.value = rect
        crop.value = originCrop?.(index) ?? WHOLE
        dy.value = withTiming(0, timing)
        p.value = withTiming(0, timing, (finished) => finished && scheduleOnRN(done))
      } else if (reduced) {
        done()
      } else {
        fade.value = withTiming(0, { duration: FADE }, (finished) => finished && scheduleOnRN(done))
      }
    })()
    return () => {
      live = false
    }
    // One close per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing])

  // The bars hide and come back with a single tap.
  const [chrome, setChrome] = useState(true)
  const bars = useSharedValue(1)
  useEffect(() => {
    bars.value = reduced ? Number(chrome) : withTiming(Number(chrome), { duration: FADE })
  }, [chrome, bars, reduced])

  // ── Gestures ─────────────────────────────────────────────────────────────
  // One finger: moves the picture when zoomed in, otherwise the track
  // sideways or the picture down to close, whichever way it went first.
  // Two fingers pinch. A double tap zooms in on that point, or back out.
  const centre = { x: here.x + here.width / 2, y: here.y + here.height / 2 }
  const clampPan = (s: number, px: number, py: number) => {
    'worklet'
    const mx = Math.max(0, (here.width * s - W) / 2)
    const my = Math.max(0, (here.height * s - stage.height) / 2)
    return [Math.max(-mx, Math.min(mx, px)), Math.max(-my, Math.min(my, py))] as const
  }
  const zoomAround = (s: number, fx: number, fy: number, s0: number, x0: number, y0: number, animated: boolean) => {
    'worklet'
    // Keep the picture's point under (fx, fy) where it is.
    const qx = (fx - centre.x - x0) / s0
    const qy = (fy - centre.y - y0) / s0
    const [px, py] = clampPan(s, fx - centre.x - qx * s, fy - centre.y - qy * s)
    zs.value = animated ? withSpring(s, SPRING) : s
    zx.value = animated ? withSpring(px, SPRING) : px
    zy.value = animated ? withSpring(py, SPRING) : py
  }
  const start0 = useSharedValue({ s: 1, x: 0, y: 0, fx: 0, fy: 0 })
  const axis = useSharedValue(0)

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onBegin(() => {
      begin()
      start0.value = { s: zs.value, x: zx.value, y: zy.value, fx: 0, fy: 0 }
      axis.value = 0
    })
    .onUpdate((e) => {
      if (zs.value > 1.01) {
        const [px, py] = clampPan(zs.value, start0.value.x + e.translationX, start0.value.y + e.translationY)
        zx.value = px
        zy.value = py
        return
      }
      if (axis.value === 0) {
        if (Math.abs(e.translationX) < 8 && Math.abs(e.translationY) < 8) return
        axis.value = Math.abs(e.translationX) >= Math.abs(e.translationY) ? 1 : 2
      }
      if (axis.value === 1) move(e.translationX)
      else dy.value = e.translationY
    })
    .onEnd((e) => {
      if (axis.value === 1) {
        settle(e.velocityX)
        return
      }
      settle(0)
      if (axis.value === 2) {
        if (Math.abs(dy.value) > DISMISS || Math.abs(e.velocityY) > DISMISS_SPEED) scheduleOnRN(onClose)
        else dy.value = withSpring(0, SPRING)
      }
    })
    .onFinalize((_e, success) => {
      if (!success) settle(0)
    })

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      start0.value = { s: zs.value, x: zx.value, y: zy.value, fx: e.focalX, fy: e.focalY }
    })
    .onUpdate((e) => {
      const s = Math.max(1, Math.min(maxZoom, start0.value.s * e.scale))
      const { fx, fy, s: s0, x: x0, y: y0 } = start0.value
      zoomAround(s, fx + (e.focalX - fx), fy + (e.focalY - fy), s0, x0, y0, false)
    })
    .onEnd(() => {
      if (zs.value < 1.02) zoomAround(1, centre.x, centre.y, zs.value, zx.value, zy.value, true)
    })

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      const s = zs.value > 1.01 ? 1 : Math.min(2.5, maxZoom)
      zoomAround(s, e.x, e.y, zs.value, zx.value, zy.value, !reduced)
    })
  const toggleBars = () => setChrome((c) => !c)
  const singleTap = Gesture.Tap().onEnd(() => scheduleOnRN(toggleBars))
  const gestures = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap))
  for (const g of [pinch, pan, doubleTap, singleTap]) g.enabled(!moving)

  // ── Styles that move ─────────────────────────────────────────────────────
  // The backdrop, and with it the bars, fade as the picture is dragged down.
  const backdrop = useAnimatedStyle(() => ({
    opacity: p.value * fade.value * (1 - Math.min(Math.abs(dy.value) / (H * 0.6), 0.8)),
  }))
  const barStyle = useAnimatedStyle(() => ({
    opacity: p.value * fade.value * bars.value * (1 - Math.min(Math.abs(dy.value) / 80, 1)),
  }))

  const onAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName
    if (moving) return
    if (name === 'increment') track.go(1)
    else if (name === 'decrement') track.go(-1)
    else if (name === 'escape') onClose()
  }

  const window = [index - 1, index, index + 1].filter((i) => i >= 0 && i < n)

  return (
    <View style={styles.fill} accessibilityViewIsModal accessibilityLabel={labels.dialog}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }, backdrop]} />

      <GestureDetector gesture={gestures}>
        <View
          style={StyleSheet.absoluteFill}
          accessible
          accessibilityRole="image"
          accessibilityLabel={item.alt}
          accessibilityValue={many ? { text: `${index + 1} / ${n}` } : undefined}
          accessibilityActions={[
            ...(many ? [{ name: 'increment', label: labels.next }, { name: 'decrement', label: labels.previous }] : []),
            { name: 'escape', label: labels.close },
          ]}
          onAccessibilityAction={onAction}
          onAccessibilityEscape={onClose}
        >
          {window.map((i) => (
            <Picture
              key={i}
              item={items[i]}
              i={i}
              current={i === index}
              rect={fitted(i)}
              step={W + 2 * GAP}
              screen={H}
              x={x}
              p={p}
              fade={fade}
              from={from}
              crop={crop}
              zoom={{ s: zs, x: zx, y: zy, dy }}
              radius={radius}
              ready={ready}
              renderVideo={renderVideo}
            />
          ))}
        </View>
      </GestureDetector>

      <Animated.View style={[styles.top, { top: pad.top, height: BAR }, barStyle]} pointerEvents={chrome ? 'box-none' : 'none'}>
        <View style={styles.title}>{wrap(title?.(item, index), colors.color)}</View>
        {toolbar?.(item, index)}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.close}
          onPress={onClose}
          disabled={moving}
          hitSlop={8}
          style={({ pressed }) => [styles.button, { borderColor: pressed ? colors.frame : 'rgba(255,255,255,0.25)' }]}
        >
          {icons?.close ?? <Text style={[styles.glyph, { color: colors.color }]}>✕</Text>}
        </Pressable>
      </Animated.View>

      <Animated.View style={[styles.foot, { bottom: pad.bottom }, barStyle]} pointerEvents={chrome ? 'box-none' : 'none'}>
        <View style={styles.captionRow}>
          {caption && <View style={styles.caption}>{wrap(caption(item, index), colors.muted)}</View>}
          {many && <Text style={[styles.count, { color: colors.muted }]}>{`${index + 1} / ${n}`}</Text>}
        </View>
        {many && thumbnails && <Thumbs items={items} index={index} frame={colors.frame} onShow={track.show} />}
      </Animated.View>
    </View>
  )
}

/** Plain text from a render prop goes in a <Text>; anything else as it is. */
function wrap(node: ReactNode, color: string) {
  return typeof node === 'string' || typeof node === 'number' ? (
    <Text style={[styles.text, { color }]} numberOfLines={2}>
      {node}
    </Text>
  ) : (
    node
  )
}

/**
 * One item on the track. The current one also does the opening and closing
 * move: its box goes from the thumbnail's rect to its own, and the picture
 * inside from the thumbnail's crop of it to all of it. Sizes, not a scale, so
 * the corners stay `radius` the whole way.
 */
function Picture<T extends LightboxItem>({
  item,
  i,
  current,
  rect,
  step,
  screen,
  x,
  p,
  fade,
  from,
  crop,
  zoom,
  radius,
  ready,
  renderVideo,
}: {
  item: T
  i: number
  current: boolean
  rect: Rect
  step: number
  screen: number
  x: SharedValue<number>
  p: SharedValue<number>
  fade: SharedValue<number>
  from: SharedValue<Rect | null>
  crop: SharedValue<Crop>
  zoom: { s: SharedValue<number>; x: SharedValue<number>; y: SharedValue<number>; dy: SharedValue<number> }
  radius: number
  ready: boolean
  renderVideo?: (item: T, state: { active: boolean }) => ReactNode
}) {
  const box = useAnimatedStyle(() => {
    const along = x.value + i * step
    if (!current) return { left: rect.x + along, top: rect.y, width: rect.width, height: rect.height, opacity: Number(ready) }
    const o = from.value ?? rect
    const q = p.value
    const lerp = (a: number, b: number) => a + (b - a) * q
    // Dragged down, it shrinks a little as it goes.
    const shrink = 1 - Math.min(Math.abs(zoom.dy.value) / screen, 1) * 0.3
    return {
      left: lerp(o.x, rect.x) + along,
      top: lerp(o.y, rect.y),
      width: lerp(o.width, rect.width),
      height: lerp(o.height, rect.height),
      opacity: fade.value * Number(ready),
      transform: [
        { translateX: zoom.x.value },
        { translateY: zoom.y.value + zoom.dy.value },
        { scale: zoom.s.value * shrink },
      ],
    }
  })
  const picture = useAnimatedStyle(() => {
    if (!current) return { left: 0, top: 0, width: rect.width, height: rect.height }
    const o = from.value ?? rect
    const [cx, cy, cw, ch] = crop.value
    const q = p.value
    const w0 = o.width / cw
    const h0 = o.height / ch
    return {
      left: -cx * w0 * (1 - q),
      top: -cy * h0 * (1 - q),
      width: w0 + (rect.width - w0) * q,
      height: h0 + (rect.height - h0) * q,
    }
  })
  return (
    <Animated.View style={[styles.picture, { borderRadius: radius }, box]} accessibilityElementsHidden={!current}>
      {item.kind === 'video' && renderVideo ? (
        <View style={StyleSheet.absoluteFill}>{renderVideo(item, { active: current })}</View>
      ) : (
        <Animated.Image
          source={{ uri: item.kind === 'image' ? item.src : (item.poster ?? item.src) }}
          style={[styles.image, picture]}
          resizeMode="stretch"
          accessibilityIgnoresInvertColors
        />
      )}
    </Animated.View>
  )
}

/** The row of thumbnails, the current one framed, scrolled to keep it in view. */
function Thumbs({ items, index, frame, onShow }: { items: LightboxItem[]; index: number; frame: string; onShow: (i: number) => void }) {
  const row = useRef<ScrollView>(null)
  const [width, setWidth] = useState(0)
  const cell = THUMB + 8 + 6
  useEffect(() => {
    row.current?.scrollTo({ x: Math.max(0, index * cell - (width - cell) / 2), animated: true })
  }, [index, width, cell])
  return (
    <ScrollView
      ref={row}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      contentContainerStyle={styles.thumbs}
    >
      {items.map((it, i) => (
        <Pressable
          key={i}
          accessibilityRole="button"
          accessibilityLabel={it.alt || `${i + 1} / ${items.length}`}
          accessibilityState={{ selected: i === index }}
          onPress={() => onShow(i)}
          style={[styles.thumbFrame, { borderColor: i === index ? frame : 'transparent' }]}
        >
          <Image
            source={{ uri: it.thumb ?? (it.kind === 'image' ? it.src : (it.poster ?? it.src)) }}
            style={[styles.thumb, { opacity: i === index ? 1 : 0.55 }]}
          />
        </Pressable>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  picture: { position: 'absolute', overflow: 'hidden' },
  image: { position: 'absolute' },
  top: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  title: { flex: 1, minWidth: 0 },
  button: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontSize: 18 },
  foot: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 12 },
  captionRow: { flexDirection: 'row', alignItems: 'baseline', gap: 16, paddingHorizontal: 16, maxWidth: '100%' },
  caption: { flexShrink: 1 },
  text: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  count: { fontSize: 13, fontVariant: ['tabular-nums'] },
  thumbs: { gap: 6, paddingHorizontal: 16 },
  thumbFrame: { padding: 2, borderWidth: 2, borderRadius: 10 },
  thumb: { width: THUMB, height: THUMB, borderRadius: 6 },
})
