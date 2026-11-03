# expo-headless-mcp

An MCP server that lets an AI **see and operate an Expo / React Native app without an emulator, a phone or a browser** — real PNG screenshots, taps, typing, scrolling and automatic bug hunting. (Русская версия: [README.ru.md](README.ru.md))

## Documentation
- [Getting started](docs/getting-started.md) — install for Claude Code / Claude Desktop / Cursor, first run
- [Tools reference](docs/tools.md) — every tool and parameter
- [Device mode](docs/device-mode.md) — Android emulator/phone and iOS Simulator, consent and safety model
- [How it works](docs/how-it-works.md) — architecture, what is supported, development
- [Troubleshooting](docs/troubleshooting.md)

## How it works
Metro + Expo Go need a native runtime, so instead:
1. `esbuild` bundles your project (`App.*` or `main`), swapping `react-native` for a light shim (`src/shim/rn.js`) and native-only packages (`expo-*`, `react-native-*`) for stubs.
2. The app runs in Node; React renders into our own tree (`react-reconciler`).
3. Layout is computed by Yoga (the flexbox engine React Native uses) and painted by Skia (`@napi-rs/canvas`) into a PNG.

Limits: an approximation, not real iOS/Android — fonts, shadows, animations and native modules differ; `expo-router` / `react-navigation` are not supported; state resets on `refresh_screen`.

## Tools
- `refresh_screen` — rebuild and show the screen (`projectPath`, `entry`, `width`, `height`, `scale`, `reload`)
- `click_screen` — tap at `x,y` or by `target` (testID / text), `long`, or `alert:<button>`
- `type_text` — type into a TextInput (`target` or `x,y`, `submit`, `append`)
- `scroll_screen` — scroll the area under `x,y`
- `describe_screen` — text outline of elements + layout warnings (overlap, clipped text, off-screen)
- `auto_test` — monkey-test everything: several rounds of reload, fill every input with varied data (empty, invalid, valid, very long, special characters, **Cyrillic, CJK, Arabic/Hebrew, emoji**), tap every button/switch (scrolling to reach it), dismiss alerts. Reports crashes, console errors, layout problems and dead buttons with screenshots.

The server ships built-in `instructions`: after any code change the AI must rebuild, check by hand, run `auto_test`, fix and repeat until a full pass is clean. The MCP prompt `verify_changes` triggers the same loop.

## Languages
The server's text is English, and the AI answers in whatever language the user writes in. Rendering falls back to system fonts for Latin, Cyrillic, CJK, Devanagari, Arabic, Hebrew and emoji (install Noto fonts on Linux). Right-to-left *layout* (`I18nManager`) is not simulated; RTL text itself renders.

## Install
```
claude mcp add expo -e EXPO_PROJECT=/path/to/app -- npx -y expo-headless-mcp
```
Tests: `npm test` (end-to-end), `node test/mcp.js` (stdio).

## Real device mode (optional)
Besides the headless renderer, the AI can drive **Expo Go on an Android emulator or a USB phone** through `adb` (Windows, macOS, Linux) and **in a booted iOS Simulator** (macOS with Xcode only). Physical iPhones are not supported: Apple does not allow remote input without heavy tooling — open Expo Go on the iPhone yourself.

Tools: `device_list` (read-only), `use_target` (`device` / `headless`), `press_key`; `refresh_screen`, `click_screen`, `type_text`, `scroll_screen`, `describe_screen` then act on the device.

Safety rules built into the server:
- **Nothing is connected / adb missing →** it says so, changes nothing, and recommends that you check the app yourself (or use headless mode).
- **USB debugging off or unauthorized →** it explains how to enable it and warns up front that it will tap, type and scroll on your phone.
- **Consent first.** It asks you (MCP elicitation, or via the AI in chat if your client lacks it) before controlling a physical phone, before installing Expo Go when it is missing, and before replacing an Expo Go whose SDK does not match the project (the matching build comes from Expo's official release list; a downgrade needs an uninstall first, which is stated in the question). **If you decline, nothing is done and it will not retry.**
- It only touches **Expo Go**: every tap/type/swipe first checks that Expo Go is in the foreground. Allowed keys: back, enter, tab, delete.
- `auto_test` is headless-only (it taps everything). Non-ASCII text cannot be typed through adb — test other languages in headless mode.

**Status:** the Android path has been used on a real phone by the author, and is covered by automated tests against a fake `adb`.

Starting the dev server runs `npx expo start` in your project (it asks before running `npm install` if dependencies are missing). Override with `EXPO_MCP_METRO_CMD`; set `EXPO_MCP_ADB` to use a specific adb.

### iOS Simulator notes
- Needs macOS + Xcode (`xcrun simctl`) and Facebook **idb** for taps/typing/UI tree (`brew tap facebook/fb && brew install idb-companion && pip3 install fb-idb`). Without idb the server only tells you how to install it; it never installs it.
- Expo Go for the project's SDK is installed/replaced only after you consent (official build from Expo's release list).
- The simulator is disposable, so there is no per-app focus check; there is no hardware Back key on iOS.
- **Status:** the iOS path is covered by tests against fake `xcrun`/`idb` only — it has not been run on a real Mac yet.
