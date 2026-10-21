import { useRef, useState } from 'react'
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { StatusBar } from 'expo-status-bar'
import { Gallery, Lightbox, type LightboxItem, type Rect } from 'react-native-motion-lightbox'

// The demo site's photos, from lightbox.gullberg.no.
const photo = (id: string, width: number, height: number, alt: string, focus?: [number, number], zoom?: number): LightboxItem => ({
  kind: 'image',
  src: `https://lightbox.gullberg.no/photos/${id}-1280.webp`,
  thumb: `https://lightbox.gullberg.no/photos/${id}-thumb.webp`,
  width,
  height,
  alt,
  focus,
  zoom,
})

const MESSAGE = [
  photo('25Bu6uO9xLw', 6000, 4000, 'Nusfjord, a fishing village in Lofoten'),
  photo('6BRuv2Wqwhc', 4000, 6000, 'A red and white lighthouse in the sea'),
  photo('DmA484UHAzw', 4748, 2635, 'Green northern lights over a lake'),
  photo('B4H-44aAzqc', 2081, 3123, 'A pigeon on wet pavement'),
]
const ALBUM = [
  photo('cKBsq-5U17A', 3358, 2239, 'Man standing on a cliff over a river', [0.28, 0.35], 2.5),
  photo('4sVimJidmpQ', 4671, 7006, 'Fallow deer in a forest', [0.5, 0.46], 1.6),
  photo('N9vsB6OEeKM', 6000, 4000, 'Trees beside a lake', [0.41, 0.88], 2.5),
  photo('ut7XZMquCoU', 6038, 4025, 'Houses by the water in Lofoten', [0.68, 0.68], 1.8),
]
const GRID = [...MESSAGE, ...ALBUM]

export default function App() {
  return (
    <GestureHandlerRootView style={styles.fill}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.h1}>react-native-motion-lightbox</Text>

        <Text style={styles.h2}>In a message</Text>
        <View style={styles.bubble}>
          <Text style={styles.body}>Four from the trip. Swipe through them.</Text>
          <Gallery
            items={MESSAGE}
            aspect={4 / 3}
            fit="contain"
            peek={28}
            gap={6}
            radius={10}
            caption={(item) => item.alt}
            onLongPress={(i) => Alert.alert('Message menu', `Long press on picture ${i + 1}`)}
          />
        </View>

        <Text style={styles.h2}>Cropped to a focus point, with autoplay</Text>
        <Gallery items={ALBUM} autoplay={4000} caption={(item) => item.alt} />

        <Text style={styles.h2}>A grid, and the lightbox on its own</Text>
        <Grid />

        {Array.from({ length: 4 }, (_, i) => (
          <Text key={i} style={styles.body}>
            Some text below, so the screen scrolls. A vertical swipe that starts on a gallery should still scroll it.
          </Text>
        ))}
      </ScrollView>
    </GestureHandlerRootView>
  )
}

function Grid() {
  const cells = useRef<(View | null)[]>([])
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const origin = (i: number) =>
    new Promise<Rect | undefined>((resolve) => {
      const cell = cells.current[i]
      if (!cell) return resolve(undefined)
      cell.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }))
    })
  return (
    <View style={styles.grid}>
      {GRID.map((item, i) => (
        <Pressable
          key={item.src}
          ref={(el) => {
            cells.current[i] = el
          }}
          accessibilityRole="imagebutton"
          accessibilityLabel={item.alt}
          style={styles.cell}
          onPress={() => {
            setIndex(i)
            setOpen(true)
          }}
        >
          <Image source={{ uri: item.thumb }} style={styles.cellImage} />
        </Pressable>
      ))}
      <Lightbox
        items={GRID}
        index={index}
        open={open}
        onClose={() => setOpen(false)}
        onIndexChange={setIndex}
        origin={origin}
        // The cells show the middle square of each photo.
        originCrop={(i) => {
          const { width = 1, height = 1 } = GRID[i]
          return width > height ? [(1 - height / width) / 2, 0, height / width, 1] : [0, (1 - width / height) / 2, 1, width / height]
        }}
        caption={(item) => item.alt}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#1d100f' },
  page: { padding: 16, paddingTop: 72, gap: 14 },
  h1: { color: '#fbe9e4', fontSize: 24, fontWeight: '600' },
  h2: { color: '#fbe9e4', fontSize: 17, fontWeight: '600', marginTop: 18 },
  body: { color: '#d9c3bd', fontSize: 15, lineHeight: 21 },
  bubble: { backgroundColor: '#2b1b19', borderRadius: 16, padding: 12, gap: 10, maxWidth: 360 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  cell: { width: '32.5%', aspectRatio: 1, borderRadius: 6, overflow: 'hidden' },
  cellImage: { width: '100%', height: '100%' },
})
