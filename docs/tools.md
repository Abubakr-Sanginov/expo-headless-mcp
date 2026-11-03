# Tools reference

All coordinates are in the units of the screenshot you last received (headless mode: dp; device mode: pixels of the returned, possibly downscaled image). Element positions from `describe_screen` use the same units, so you can pass its `center=(x,y)` straight to `click_screen`.

Every action that changes the screen returns a **new screenshot** plus, when relevant, *Layout warnings*, *Alerts* and *App console* output.

## Screen tools

### `refresh_screen`
Bundles the project, (re)starts the app and returns a screenshot. Call it first and after every code change. State is reset on each rebuild.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `projectPath` | string | `EXPO_PROJECT` or server cwd | Expo project directory |
| `reload` | boolean | `true` | Re-bundle and restart. `false` re-captures the current state |
| `entry` | string | auto | Entry file relative to the project, e.g. `App.tsx` |
| `width` / `height` | number | 390 / 844 | Screen size in dp (headless only) |
| `scale` | number | 1.5 | PNG pixel scale (headless only) |

Entry detection: `App.tsx|jsx|js|ts` in the project root or `src/`, otherwise `package.json` `"main"` (an `index.js` that calls `registerRootComponent`). `expo-router` apps are not supported.

### `click_screen`
Taps. Either `x` + `y`, or `target` (a `testID`, accessibility label, placeholder or visible text — exact match first, then substring).

| Parameter | Type | Description |
|---|---|---|
| `x`, `y` | number | Tap position |
| `target` | string | Element to tap. `alert:<button>` answers an `Alert.alert` dialog (headless) |
| `long` | boolean | Long press |

Taps fire the nearest ancestor `onPress` (or `onPressIn` / `onPressOut` / `onLongPress`); tapping a `TextInput` focuses it. Disabled controls are ignored.

### `type_text`
Types into a text field, **replacing** its value unless `append` is true.

| Parameter | Type | Description |
|---|---|---|
| `text` | string | Text to type |
| `target` | string | Field by `testID` / placeholder / label / current value |
| `x`, `y` | number | Or locate the field by position |
| `submit` | boolean | Also press Enter / fire `onSubmitEditing` |
| `append` | boolean | Keep the existing value |

With neither `target` nor `x`/`y` it types into the focused field.

### `scroll_screen`
Scrolls the `ScrollView` / `FlatList` under `(x, y)` by `dy` (vertical) or `dx` (horizontal). Positive `dy` scrolls down.

### `describe_screen`
Text outline of everything on screen — texts, inputs (with value / placeholder / `FOCUSED`), images, pressables — with position, size and tap-center. In headless mode it also lists **layout warnings**:

- `overlap:` two texts / inputs overlap
- `text overflows its box` — text needs more height than its container has
- `is truncated by numberOfLines`
- `extends beyond screen width`

## Automatic testing

### `auto_test` (headless only)
Monkey-tests the whole app and returns a report with screenshots of problems.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `rounds` | integer 1–8 | 4 | Reloads of the app, each with a different data set |
| `maxStepsPerRound` | integer 1–100 | 30 | Max taps per round |

Each round it reloads the app, fills every `TextInput` with the round's data, then taps every pressable and switch (scrolling to reach them, dismissing alerts). Input data adapts to the field (email / password / numeric / text) and includes empty values, invalid and valid values, 300-character strings, SQL/HTML-looking strings, Cyrillic, CJK, Arabic, Hebrew and emoji.

The report lists, by severity:
- `ERROR` — render crashes, thrown handlers, `console.error`
- `WARN` — `console.warn`
- `LAYOUT` — overlaps, clipped text, off-screen elements
- `INFO` — a button that never had any visible effect in any round

A "findings: none" result means none of the above were detected — it does not prove the app is correct.

## Device tools

See [Device mode](device-mode.md) for the full safety model.

### `device_list`
Read-only. Lists Android emulators / USB phones (via `adb`) and booted iOS Simulators (macOS), and says what must be done before they can be used. Changes nothing.

### `use_target`
Chooses where the other tools act.

| Parameter | Type | Description |
|---|---|---|
| `target` | `headless` \| `device` | `headless` = built-in renderer (default); `device` = Expo Go on a real/emulated device |
| `serial` | string | adb serial or iOS UDID, when several targets are ready |
| `projectPath` | string | Project to run |
| `confirmed` | string[] | Consent keys the user approved in chat — only when a previous call asked the AI to relay a question |

Selecting `device` may ask the user for consent (see below), starts the Expo dev server and opens the app in Expo Go. `headless` stops the dev server.

### `press_key`
Device mode only. Allowed keys: `back` (Android only), `enter`, `tab`, `delete`.

## Prompt

### `verify_changes`
A ready-made prompt that tells the AI to rebuild, exercise what changed, run `auto_test`, fix problems and repeat until clean.
