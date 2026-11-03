# How it works

Expo Go and Metro need a native runtime, so the default mode does not run your app on a phone. Instead:

```
your project ──esbuild──▶ one JS bundle ──Node──▶ React ──react-reconciler──▶ host tree
   (react-native → shim,                                                         │
    native packages → stubs)                                      Yoga (flexbox layout)
                                                                                 │
                                                                Skia canvas ──▶ PNG
```

1. **Bundle.** `esbuild` bundles your entry file. `react-native` is replaced by a lightweight shim (`src/shim/rn.js`); native-only packages are replaced by stubs. TypeScript, JSX and image imports work out of the box.
2. **Run.** The bundle executes in Node and shares one React instance with the renderer.
3. **Render.** A custom `react-reconciler` host builds a tree of views, texts, inputs and images.
4. **Layout.** [Yoga](https://www.yogalayout.dev/) — the flexbox engine React Native itself uses — computes the layout, so sizes and positions follow RN's rules.
5. **Paint.** Skia (`@napi-rs/canvas`) draws backgrounds, borders, radii, shadows, text, images and spinners into a PNG.
6. **Interact.** Taps are hit-tested against the layout and call your real `onPress` handlers; typing calls `onChangeText`; scrolling moves the `ScrollView` offset. After each action the app is given a moment to settle (effects, timers, promises), then re-rendered.

Layout checks (overlap, clipped text, off-screen) are computed from the same layout tree.

## What is supported

**React Native components:** `View`, `Text`, `Image`, `ImageBackground`, `ScrollView`, `FlatList`, `SectionList`, `TextInput`, `Pressable`, `TouchableOpacity` / `Highlight` / `WithoutFeedback`, `Button`, `Switch`, `Modal`, `ActivityIndicator`, `SafeAreaView`, `KeyboardAvoidingView`, `StatusBar`.

**APIs:** `StyleSheet`, `Platform` (reports `ios`), `Dimensions` / `useWindowDimensions` / `PixelRatio`, `Alert`, `Keyboard`, `Linking`, `AppState`, `Appearance` / `useColorScheme` (light), `Animated` (values resolve instantly; animations complete immediately), `LayoutAnimation` and `Vibration` (no-ops).

**Styles:** full flexbox (including `gap`, `aspectRatio`, absolute positioning, `flexWrap`), margins/padding/borders, `borderRadius` (per corner), colors and opacity, shadows / `elevation`, fonts (size, weight, style, family fallback), `textAlign`, `lineHeight`, `numberOfLines`, `textDecorationLine`, `overflow`, `zIndex`.

**Packages with dedicated stand-ins:** `expo` (`registerRootComponent`), `expo-status-bar`, `expo-font`, `expo-splash-screen`, `expo-constants`, `react-native-safe-area-context`, `@expo/vector-icons` (icons render as placeholders so layout is preserved), `@react-native-async-storage/async-storage` (in-memory).

**Everything else native** (`expo-*`, `@expo/*`, `react-native-*`, `@react-native*/*`, plus any import that cannot be resolved) becomes a no-op stub: every export is a callable that returns `undefined`. Components from stubbed packages render nothing; hooks that must return a value (e.g. `const [a, b] = useThing()`) will throw — this shows up as an `ERROR` in the console output and is the cue to add a dedicated stand-in in `src/shim/` and map it in `src/bundler.js`.

**Text and languages:** fonts fall back to system fonts for Latin, Cyrillic, CJK, Devanagari, Arabic, Hebrew and emoji (install Noto fonts on Linux). Right-to-left *text* renders; right-to-left *layout mirroring* (`I18nManager`) is not simulated.

## What is not supported

- `expo-router` and `react-navigation` (no native navigation stack)
- Native modules (camera, maps, sensors, notifications…) — stubbed
- Pixel-exact fidelity with iOS/Android: fonts, shadows, text metrics and animations differ. Use [device mode](device-mode.md) for the real thing
- Gestures beyond tap / long-press / scroll (no pinch, pan responders, drag)
- Web views, video, Lottie

## Runtime errors

If your app throws while rendering, the screenshot shows a red "Runtime error" screen and the message appears in the console output of the tool result. Errors in event handlers and timers are logged too. The app's `console.*` output is captured (never written to the MCP protocol stream).

## Development

```bash
git clone https://github.com/Abubakr-Sanginov/expo-headless-mcp
cd expo-headless-mcp && npm install
npm test            # end-to-end tests (headless + fake adb / xcrun / idb)
```

| File | Role |
|---|---|
| `src/server.js` | MCP tools, instructions, consent flow |
| `src/bundler.js` | esbuild plugin: shims, stubs, entry detection |
| `src/session.js` | App lifecycle, hit-testing, actions, `describe` |
| `src/reconciler.js` | React host tree |
| `src/layout.js` / `src/paint.js` | Yoga layout / Skia drawing |
| `src/autotest.js` | `auto_test` |
| `src/device.js` / `src/ios.js` | Android (`adb`) and iOS Simulator control |
| `src/shim/` | `react-native` shim and package stand-ins |
| `test/` | fixtures, fake `adb` / `xcrun` / `idb`, tests |

Test hooks (not for normal use): `EXPO_MCP_SKIP_DOWNLOAD`, `EXPO_MCP_XCRUN`, `EXPO_MCP_IDB`, `EXPO_MCP_PLUTIL`, `EXPO_MCP_FORCE_DARWIN`.
