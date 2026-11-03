# Troubleshooting

## The tools don't appear in my client
Restart the client after `claude mcp add`. Check the connection with `claude mcp list` — it should show `expo … ✔ Connected`. On native Windows use `cmd /c npx -y expo-headless-mcp`.

## "No App.(js|jsx|ts|tsx) or usable "main" found"
The server looks for `App.*` in the project root or `src/`, then `package.json` `"main"`. Pass `entry` (e.g. `app/App.tsx`) to `refresh_screen`, or check `EXPO_PROJECT` points at the project root. `expo-router` projects (an `app/` directory without `App.*`) are not supported.

## A red "Runtime error" screen
Your app threw while rendering. Read the message in the tool output. If it mentions `undefined is not iterable` or `is not a function` coming from an `expo-*` / `react-native-*` package, that package is stubbed (see [How it works](how-it-works.md)) — a hook returning an array/object needs a dedicated stand-in.

## Icons look like grey squares
`@expo/vector-icons` glyphs are rendered as placeholders so sizes and colours are preserved, but the real icon shapes are not drawn.

## Text looks different from my phone
Fonts and text metrics are an approximation. Treat borderline wrapping/clipping findings with care, and confirm in [device mode](device-mode.md) if it matters.

## Images are grey boxes with a cross
The image failed to load. Remote images are fetched with an 8-second timeout; local `require('./a.png')` assets are inlined. Check the URL / path.

## `auto_test` says "none" but I see a bug
`auto_test` finds crashes, console errors, layout problems and dead buttons. It cannot know that a label is *wrong* or a calculation is incorrect. Ask the AI to check specific behaviour with `click_screen` / `type_text`.

## Device mode

| Symptom | Fix |
|---|---|
| "adb … was not found" | Install Android platform-tools, put `adb` on `PATH`, or set `ANDROID_HOME` / `EXPO_MCP_ADB` |
| Phone not listed | Data cable? USB mode *File transfer*? USB debugging on? Run `adb devices` yourself |
| `unauthorized` | Unlock the phone, accept "Allow USB debugging?", or revoke authorizations in Developer options and reconnect |
| Permission denied by the client / user declined | By design nothing was changed. Ask again if you changed your mind |
| "Expo Go is not in the foreground … Refusing to touch other apps" | Safety check. Call `refresh_screen` to bring the app back |
| Typing refused (non-ASCII) | `adb` cannot type Cyrillic/CJK/emoji. Test those in headless mode |
| Dev server did not start | Run `npx expo start` in your project once to see the error; make sure dependencies are installed |
| iOS: "needs idb" | `brew tap facebook/fb && brew install idb-companion && pip3 install fb-idb` |
| iOS: an "Open in Expo Go?" dialog is on screen | Visible in the screenshot — tap **Open** with `click_screen` |

## Reporting problems
Open an issue at <https://github.com/Abubakr-Sanginov/expo-headless-mcp/issues> with the tool output, your OS, Node version and, if possible, a minimal project.
