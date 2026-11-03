# Getting started

`expo-headless-mcp` lets an AI assistant **see and operate your Expo / React Native app** — screenshots, taps, typing, scrolling and automatic bug-hunting — without an emulator, a phone or a browser.

## Requirements

- Node.js 20 or newer
- An Expo / React Native project (JavaScript or TypeScript) with an `App.*` file, or a `package.json` `"main"` that mounts the app
- An MCP client: Claude Code, Claude Desktop, Cursor, or any client that speaks MCP over stdio

You do **not** need Xcode, Android Studio, an emulator or a phone for the default (headless) mode.

## Install

### Claude Code

```bash
claude mcp add expo -e EXPO_PROJECT=/path/to/your/app -- npx -y expo-headless-mcp
```

On native Windows (not WSL) wrap `npx` with `cmd /c`:

```bash
claude mcp add expo -e EXPO_PROJECT=C:\path\to\your\app -- cmd /c npx -y expo-headless-mcp
```

Add `-s user` to make it available in every project, or run the command inside a project to scope it there. Restart Claude Code afterwards.

### Claude Desktop / Cursor / other clients

Add this to the client's MCP configuration:

```json
{
  "mcpServers": {
    "expo": {
      "command": "npx",
      "args": ["-y", "expo-headless-mcp"],
      "env": { "EXPO_PROJECT": "/path/to/your/app" }
    }
  }
}
```

`EXPO_PROJECT` is optional: every tool call that loads the app also accepts `projectPath`, and the server falls back to its working directory.

### From source

```bash
git clone https://github.com/Abubakr-Sanginov/expo-headless-mcp
cd expo-headless-mcp && npm install
claude mcp add expo -e EXPO_PROJECT=/path/to/your/app -- node /path/to/expo-headless-mcp/src/server.js
```

## First run

Ask your assistant something like:

> Open my app and check that the login form works.

It will call `refresh_screen` (bundles the app and returns a screenshot), then `click_screen` / `type_text` to use the form, then `auto_test` to exercise everything. You can also run the built-in prompt `verify_changes` from your client's prompt menu.

The server ships its own instructions to the AI: after **any** code change it must rebuild, check the change by hand, run `auto_test`, fix what it finds and repeat until a full pass is clean. If you also want this rule in your project, copy this into your `CLAUDE.md`:

```markdown
# Verifying the app with the `expo` MCP
When you add or change a feature (screen, button, form, bug fix):
1. `refresh_screen` — rebuild; read the screenshot, layout warnings and console.
2. Exercise the change: `click_screen`, `type_text` (valid, empty, long, special characters, several languages), `scroll_screen`.
3. `auto_test` — monkey-test the whole app.
4. Fix anything wrong and repeat until a full pass is clean.
5. Re-check untouched features. Never say "done" without seeing it work on screen.
```

## Typical workflow

```
refresh_screen            → screenshot + layout warnings + app console
click_screen / type_text  → act, get a new screenshot each time
describe_screen           → exact coordinates and text of every element
auto_test                 → report of crashes, errors, overlaps, dead buttons
(edit code)  → refresh_screen again — state resets on every rebuild
```

Next: [Tools reference](tools.md) · [Device mode](device-mode.md) · [How it works](how-it-works.md) · [Troubleshooting](troubleshooting.md)
