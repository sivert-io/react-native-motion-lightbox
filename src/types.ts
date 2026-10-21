import type { ReactNode } from 'react'

export interface LightboxItem {
  kind: 'image' | 'video'
  /** The full-size image, or the video file. */
  src: string
  alt?: string
  /** Intrinsic size. Without it, the item is measured once it loads. */
  width?: number
  height?: number
  /** A video's still. */
  poster?: string
  /** A small image for the thumbnail row. Defaults to `src` (or `poster`). */
  thumb?: string
  /** What a cropped view of it centres on, as fractions of it: x, y. Default the middle. See `cropOf`. */
  focus?: [number, number]
  /** How far a cropped view zooms in on `focus`. 1, the default, is the biggest crop that fits. */
  zoom?: number
}

/** A region of the picture, as fractions of it: left, top, width, height. */
export type Crop = [number, number, number, number]

/** A box on screen, in window coordinates (what `measureInWindow` gives). */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface LightboxLabels {
  dialog: string
  close: string
  previous: string
  next: string
  /** The gallery's slideshow button. */
  pause: string
  play: string
}

export interface LightboxIcons {
  close: ReactNode
  pause: ReactNode
  play: ReactNode
}

export interface LightboxColors {
  backdrop: string
  color: string
  muted: string
  /** The frame around the current thumbnail. */
  frame: string
  /** Behind each picture in a gallery: a fitted one's frame, and what shows of the next one when it peeks. */
  slide: string
}

export interface LightboxProps<T extends LightboxItem = LightboxItem> {
  items: T[]
  /** The item to show. Changing it while open moves there. */
  index: number
  open: boolean
  /** Asked to close: the close button, a swipe down, Android's back button, VoiceOver's escape. Set `open` to false to close. */
  onClose: () => void
  /** The item on screen changed. */
  onIndexChange?: (index: number) => void
  /** The closing animation has finished and the lightbox is gone. */
  onExited?: (index: number) => void
  /**
   * Where an item opens out of and closes back into: a rect in window
   * coordinates, or a promise of one (from `measureInWindow`). Without one,
   * the lightbox fades in and out instead.
   */
  origin?: (index: number) => Rect | Promise<Rect | undefined> | undefined
  /** The part of the item the thumbnail shows, when it's a crop of it. */
  originCrop?: (index: number) => Crop | undefined
  /** Draw a video yourself. It fills the item's box; `active` is true for the one on screen. */
  renderVideo?: (item: T, state: { active: boolean }) => ReactNode
  /** Top left: a sender, a time, a name. */
  title?: (item: T, index: number) => ReactNode
  /** Top right, before the close button. */
  toolbar?: (item: T, index: number) => ReactNode
  /** Under the picture, before the "3 / 12" count. */
  caption?: (item: T, index: number) => ReactNode
  /** The thumbnail row, when there's more than one item. Default true. */
  thumbnails?: boolean
  /** Default 8. */
  maxZoom?: number
  /** Corner radius of the pictures, in points, the same all the way through the opening move. Default 12. */
  radius?: number
  labels?: Partial<LightboxLabels>
  icons?: Partial<LightboxIcons>
  colors?: Partial<LightboxColors>
  /** Room to leave for the status bar and the home indicator. Pass your safe area insets. */
  insets?: { top: number; bottom: number }
}
