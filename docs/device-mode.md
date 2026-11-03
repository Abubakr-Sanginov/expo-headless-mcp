# Device mode (Android and iOS Simulator)

The default headless renderer is an approximation. When you want to see the app **in the real Expo Go**, the AI can drive:

| Target | Host OS | Needs |
|---|---|---|
| Android emulator | Windows, macOS, Linux | `adb` (Android platform-tools) |
| Android phone over USB | Windows, macOS, Linux | `adb`, USB debugging enabled |
| iOS Simulator | macOS only | Xcode (`xcrun simctl`) and Facebook `idb` |
| Physical iPhone | — | **Not supported** (Apple does not allow remote input without heavy tooling). Open Expo Go on the iPhone yourself |

It is **opt-in**: nothing touches a device unless the AI calls `use_target` with `target: "device"`, which it only does when you ask for device testing.

## What happens when you ask for device testing

1. `device_list` (read-only) finds targets.
2. **Nothing connected, or `adb` missing →** the AI says so, changes nothing, and recommends that you check the app yourself on your device (or continue headless).
3. **USB debugging off / not authorized →** the AI explains how to enable it and **warns you before starting that it will tap, type and scroll on your phone.**
4. `use_target` runs, asking for consent (below), then starts the Expo dev server (`npx expo start` in your project) and opens the app in Expo Go.
5. `refresh_screen`, `click_screen`, `type_text`, `scroll_screen`, `describe_screen` and `press_key` now act on the device.

### Enable USB debugging (Android)
1. Settings → About phone → tap **Build number** 7 times.
2. Settings → System → Developer options → turn on **USB debugging**.
3. Connect with a data cable, set USB mode to *File transfer*, unlock the phone and tap **Allow** on the "Allow USB debugging?" dialog.

## Consent model

The server asks **before**:

| Action | Asked when |
|---|---|
| Controlling a physical phone | Always, once per phone per session (not for emulators/simulators) |
| Installing Expo Go | It is missing on the device |
| Replacing Expo Go | The installed Expo Go's SDK differs from your project's SDK. Android cannot downgrade in place, so a *downgrade* means uninstalling first — the question says so |
| Running `npm install` | `node_modules/expo` is missing in your project |

The matching Expo Go build comes from Expo's official release list (`api.expo.dev/v2/versions/latest`, GitHub release assets).

How you are asked:
- **MCP elicitation** — if your client supports it, you get a native yes/no prompt from the server itself. The AI cannot answer for you.
- **Fallback** — otherwise the tool returns the exact question and a confirmation key; the AI must ask you in chat and only then call again with `confirmed`.

**If you decline, nothing is done, and the AI is told not to retry or look for workarounds.**

## Safety rules

- Every tap / type / swipe on Android first checks that **Expo Go is in the foreground**; if another app is open the action is refused.
- Only four keys can be pressed: `back` (Android), `enter`, `tab`, `delete`.
- `auto_test` is disabled in device mode (it taps everything — unsafe on a real phone). Switch back with `use_target` → `headless` to run it.
- The iOS Simulator is disposable and has no per-app focus API, so there is no foreground check there.
- Text typing on devices is **ASCII only** (`adb input text` / `idb ui text`). Non-ASCII text (Cyrillic, CJK, emoji, accents) is refused with a message — test those languages in headless mode.

## iOS Simulator setup

```bash
brew tap facebook/fb && brew install idb-companion
pip3 install fb-idb
```

Boot a simulator from Xcode or the Simulator app first. The server never installs `idb` itself; without it, it only tells you how to install it.

## Environment variables

| Variable | Purpose |
|---|---|
| `EXPO_PROJECT` | Default project directory |
| `EXPO_MCP_ADB` | Use a specific `adb` binary |
| `EXPO_MCP_METRO_CMD` | Custom dev-server command instead of `npx expo start` (`{port}` is replaced) |

If `adb` is not on `PATH`, the server also looks in `ANDROID_HOME` / `ANDROID_SDK_ROOT`, the default Android Studio SDK location for your OS, and `tools/platform-tools` inside this package.

## Status

Android mode has been used on a real phone by the author and is covered by automated tests against a fake `adb`. iOS mode is covered only by tests against fake `xcrun` / `idb` and has not yet been run on a real Mac — please report issues.
