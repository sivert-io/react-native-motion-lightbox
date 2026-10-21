// Runs the package from ../src, so the example always shows what's on main.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const root = path.resolve(__dirname, '..')
const config = getDefaultConfig(__dirname)

config.watchFolders = [root]
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]

// One copy of each peer: the root has its own for type-checking, and two
// copies of React or Reanimated in one bundle break at runtime.
const peers = ['react', 'react-native', 'react-native-reanimated', 'react-native-gesture-handler', 'react-native-worklets']
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
config.resolver.blockList = peers.map((p) => new RegExp(`^${escape(path.join(root, 'node_modules', p))}/.*$`))
config.resolver.extraNodeModules = {
  'react-native-motion-lightbox': path.join(root, 'src'),
  ...Object.fromEntries(peers.map((p) => [p, path.join(__dirname, 'node_modules', p)])),
}

module.exports = config
