#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Session, pushLog, drainLogs } from './session.js';
import { autoTest } from './autotest.js';
import { Device, UserDecision, listDevices, stateGuidance, NO_ADB_HELP, USB_DEBUGGING_HELP } from './device.js';
import { IosSimulator, listSimulators, iosToolsAvailable, IDB_HELP, IOS_UNAVAILABLE } from './ios.js';

// stdout belongs to the MCP protocol: anything the app prints is captured instead.
for (const level of ['log', 'info', 'debug', 'warn', 'error']) console[level] = (...a) => pushLog(level, a);
process.on('unhandledRejection', (e) => pushLog('error', ['Unhandled rejection:', e]));
process.on('uncaughtException', (e) => pushLog('error', ['Uncaught exception:', e]));

let session = null;
let device = null; // active real device (Android emulator / USB phone); null = headless mode
let deviceMark = 0;
const granted = new Set(); // consent keys the user has approved
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEFAULT_PROJECT = process.env.EXPO_PROJECT || process.cwd();

const reply = async (s, headline) => {
  const png = await s.screenshot();
  const { warnings } = s.describe();
  const alerts = s.state.alerts.splice(0);
  const parts = [headline];
  if (alerts.length) parts.push('Alerts:\n' + alerts.map((a) => `- ${a.title}${a.message ? `: ${a.message}` : ''}${a.buttons ? ` [buttons: ${a.buttons.join(' | ')}] (press with click_screen target "alert:<button>")` : ''}`).join('\n'));
  if (warnings.length) parts.push('Layout warnings:\n' + warnings.map((w) => `- ${w}`).join('\n'));
  const logs = drainLogs();
  if (logs.length) parts.push('App console:\n' + logs.join('\n'));
  return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: parts.join('\n\n') }] };
};

const failure = (e) => ({ isError: true, content: [{ type: 'text', text: `${e.message || e}\n${drainLogs().join('\n')}`.trim() }] });

const needSession = () => {
  if (!session?.root) throw new Error('No app loaded. Call refresh_screen first.');
  return session;
};

// Asks the user (MCP elicitation) before anything that changes a device. Throws UserDecision if not approved.
const ask = async (message, key) => {
  if (granted.has(key)) return;
  if (server.server.getClientCapabilities()?.elicitation) {
    let r;
    try {
      r = await server.server.elicitInput({
        message,
        requestedSchema: { type: 'object', properties: { approve: { type: 'boolean', title: 'Allow', description: 'Check to allow this action', default: false } }, required: ['approve'] },
      });
    } catch {
      throw new UserDecision('needs-confirmation', message + '\n[confirmation key: ' + key + ']');
    }
    if (r.action === 'accept' && r.content?.approve === true) return void granted.add(key);
    throw new UserDecision('declined', message);
  }
  throw new UserDecision('needs-confirmation', message + '\n[confirmation key: ' + key + ']');
};

const decisionReply = (e) => ({
  content: [{
    type: 'text',
    text: e.kind === 'declined'
      ? 'The user declined: "' + e.message + '"\nNothing was changed on the device. Do NOT retry, do not look for workarounds, and do not do this on your own. Continue in headless mode, or tell the user how they can check it themselves.'
      : 'USER CONFIRMATION REQUIRED. Ask the user this exact question in chat, in their language, and wait for their answer:\n\n"' + e.message + '"\n\nIf they agree, call use_target again with the same arguments plus confirmed=["<confirmation key shown above>"]. If they say no (or do not answer), do nothing and do not call it again.',
  }],
});

const devReply = async (headline) => {
  const png = await device.screenshot();
  const parts = [headline];
  const problems = device.metroProblems(deviceMark);
  deviceMark = device.metroLog.length;
  if (problems.length) parts.push('Dev server output (errors):\n' + problems.join('\n'));
  const fg = await device.foreground();
  if (!fg.inExpoGo) parts.push('WARNING: Expo Go is not in the foreground (' + fg.line + '). Call refresh_screen to bring the app back.');
  return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: parts.join('\n\n') }] };
};

const needDevice = () => {
  if (!device) throw new Error('No device selected. Use use_target with target="device" first.');
  return device;
};

const INSTRUCTIONS = `You can see and operate the user's Expo / React Native app through this server (headless render, no emulator).

MANDATORY WORKFLOW whenever you add or change app code (a new feature, screen, button, form, bug fix, refactor):
1. refresh_screen to rebuild and look at the result. Read the screenshot AND the "Layout warnings" and "App console" text.
2. Exercise the new/changed behaviour yourself: click_screen every new control, type_text into every new field (valid, empty, too short, too long, special characters), scroll_screen to reach content below the fold, answer Alerts with click_screen target "alert:<button>".
3. Run auto_test to monkey-test the whole app for crashes, console errors, layout overlaps, clipped text and dead buttons. Also use describe_screen when you need exact coordinates or a text outline.
4. If anything is wrong (wrong text, overlap, off-screen element, crash, console error, button that does nothing), fix the code, then go back to step 1 and verify again. Repeat until a full pass is clean.
5. After the final fix, re-check the features you did NOT touch (auto_test covers this) to catch regressions. Never report a feature as done without having seen it work on screen.
State resets on every refresh_screen, so re-do the steps (e.g. type the form again) after each rebuild.
Multilingual: test with several languages and scripts (e.g. Cyrillic, CJK, Arabic/Hebrew RTL, emoji, long German words) because translated text is a common cause of overflow and clipping; auto_test already does this for text inputs. Always answer the user in the language they write in.
REAL DEVICE MODE (optional; Android emulator or USB phone via adb on Windows/macOS/Linux, and booted iOS Simulators on macOS with idb; physical iPhones are not supported): only use it when the user asks for testing on a real device/emulator. Call device_list first.
- If nothing is connected (or adb is missing), say so plainly, change nothing, recommend that the user check the app themselves on their phone/emulator, and offer headless testing instead. Do not try workarounds.
- If USB debugging is off or not authorized, tell the user how to enable it (device_list gives the steps) and warn them BEFORE you start that you will be tapping, typing and scrolling on their phone.
- Then call use_target with target="device". It asks the user for consent before controlling a physical phone, before installing Expo Go (when it is missing), and before replacing an Expo Go that does not match the project's SDK. If the user declines, do nothing more and never retry. If a tool asks you to relay a question to the user, ask it verbatim and only continue if they agree.
- On a device only click_screen / type_text / scroll_screen / describe_screen / press_key / refresh_screen work, and only inside Expo Go. auto_test is headless-only (it taps everything, which is unsafe on a real phone). Non-ASCII text cannot be typed on a device: test other languages in headless mode.
- Call use_target with target="headless" when done (it also stops the dev server).
Limits: this is an approximate renderer (fonts/shadows/animations differ from a device; expo-router/react-navigation are not supported). Say so if a problem might be a renderer artefact.`;

const server = new McpServer({ name: 'expo-headless-mcp', version: '0.2.0' }, { instructions: INSTRUCTIONS });

server.registerTool('refresh_screen', {
  description: 'Bundles the Expo / React Native project (no emulator, phone or browser), renders it headlessly and returns a PNG screenshot of the screen. Call first; call again after editing code (re-bundles and restarts the app). Pass reload=false to just re-capture the current state.',
  inputSchema: {
    projectPath: z.string().optional().describe('Expo project directory (default: EXPO_PROJECT env or server cwd)'),
    reload: z.boolean().optional().describe('Re-bundle and restart the app (default true)'),
    entry: z.string().optional().describe('Entry file relative to the project, e.g. App.tsx'),
    width: z.number().optional().describe('Screen width in dp (default 390)'),
    height: z.number().optional().describe('Screen height in dp (default 844)'),
    scale: z.number().optional().describe('PNG pixel scale (default 1.5)'),
  },
}, async ({ projectPath, reload = true, entry, width, height, scale }) => {
  try {
    if (device) {
      if (reload) await device.reload();
      return await devReply(reload ? 'Restarted the app in Expo Go on ' + (device.info.model || device.serial) + '.' : 'Current device screen.');
    }
    if (!session || !session.root || reload || (projectPath && projectPath !== session.project)) {
      const prev = session;
      session = new Session(projectPath || prev?.project || DEFAULT_PROJECT, { width: width ?? prev?.width, height: height ?? prev?.height, scale: scale ?? prev?.scale, entry: entry ?? prev?.entry });
      prev?.dispose();
      await session.load();
    }
    return await reply(session, `Rendered ${session.entryFile} at ${session.width}x${session.height}.`);
  } catch (e) {
    return failure(e);
  }
});

server.registerTool('click_screen', {
  description: 'Taps the screen at (x, y) in screen dp coordinates, or an element by "target" (testID, accessibilityLabel, or visible text). Fires onPress of the nearest pressable, focuses TextInputs, then returns a new screenshot. Use target "alert:<button>" to answer an Alert.',
  inputSchema: {
    x: z.number().optional(), y: z.number().optional(),
    target: z.string().optional(),
    long: z.boolean().optional().describe('Long press'),
  },
}, async ({ x, y, target, long }) => {
  try {
    if (!target && (x == null || y == null)) throw new Error('Provide x and y, or target.');
    if (device) {
      let px = x;
      let py = y;
      let what = '(' + x + ', ' + y + ')';
      if (target) {
        const n = device.findTarget(await device.nodes(), target);
        if (!n) throw new Error('No element matching "' + target + '" in Expo Go. Use describe_screen to list what is on screen.');
        px = ((n.x1 + n.x2) / 2) * device.scale;
        py = ((n.y1 + n.y2) / 2) * device.scale;
        what = '"' + target + '"';
      }
      await device.tap(px, py, long);
      await sleep(900);
      return await devReply((long ? 'Long-pressed ' : 'Tapped ') + what + '.');
    }
    const s = needSession();
    return await reply(s, await s.click({ x, y, target, long }));
  } catch (e) {
    return failure(e);
  }
});

server.registerTool('type_text', {
  description: 'Types text into a TextInput (replacing its value unless append=true) so forms and validation can be tested. Locate the field by "target" (testID, placeholder, accessibilityLabel, current value), by x/y, or omit both to use the focused field. Returns a new screenshot.',
  inputSchema: {
    text: z.string(),
    target: z.string().optional(),
    x: z.number().optional(), y: z.number().optional(),
    submit: z.boolean().optional().describe('Also fire onSubmitEditing (Enter)'),
    append: z.boolean().optional(),
  },
}, async (args) => {
  try {
    if (device) {
      const { text, target, x, y, submit, append } = args;
      if (target || x != null) {
        let px = x;
        let py = y;
        if (target) {
          const n = device.findTarget(await device.nodes(), target);
          if (!n) throw new Error('No field matching "' + target + '" in Expo Go. Use describe_screen to list what is on screen.');
          px = ((n.x1 + n.x2) / 2) * device.scale;
          py = ((n.y1 + n.y2) / 2) * device.scale;
        }
        await device.tap(px, py);
        await sleep(500);
      }
      await device.typeText(text, { replace: !append });
      if (submit) await device.key('enter');
      await sleep(700);
      return await devReply('Typed ' + JSON.stringify(text) + (submit ? ' and pressed Enter' : '') + '.');
    }
    const s = needSession();
    return await reply(s, await s.type(args));
  } catch (e) {
    return failure(e);
  }
});

server.registerTool('scroll_screen', {
  description: 'Scrolls the ScrollView/FlatList under (x, y) by dy (vertical) or dx (horizontal) dp; positive dy scrolls down. Returns a new screenshot.',
  inputSchema: { x: z.number(), y: z.number(), dx: z.number().optional(), dy: z.number().optional() },
}, async (args) => {
  try {
    if (device) {
      const { x, y, dx = 0, dy = 0 } = args;
      await device.swipe(x, y, x - dx, y - dy);
      await sleep(700);
      return await devReply('Scrolled by (' + dx + ', ' + dy + ').');
    }
    const s = needSession();
    return await reply(s, await s.scroll(args));
  } catch (e) {
    return failure(e);
  }
});

server.registerTool('describe_screen', {
  description: 'Text outline of the current screen: every text, input, image and pressable with its position, size and tap-center, plus detected layout problems (overlaps, clipped text, off-screen elements). No image.',
  inputSchema: {},
}, async () => {
  try {
    if (device) {
      await device.screenshot();
      const rows = device.describe(await device.nodes());
      return { content: [{ type: 'text', text: rows.length ? rows.join('\n') : 'No accessible elements found in Expo Go (is the app still loading?).' }] };
    }
    const { lines, warnings } = needSession().describe();
    const text = lines.join('\n') + (warnings.length ? '\n\nLayout warnings:\n' + warnings.map((w) => `- ${w}`).join('\n') : '\n\nNo layout warnings.');
    return { content: [{ type: 'text', text }] };
  } catch (e) {
    return failure(e);
  }
});


server.registerTool('auto_test', {
  description: 'Automatically exercises the whole app: reloads it several times, fills every TextInput with different data (empty, invalid, valid, very long, special characters), taps every button/switch (scrolling to reach them), dismisses alerts, and reports crashes, console errors/warnings, layout problems (overlaps, clipped text, off-screen elements) and buttons that do nothing, with screenshots of problems. Run it after every change, then fix what it reports and run it again.',
  inputSchema: {
    rounds: z.number().int().min(1).max(8).optional().describe('How many data rounds / app reloads (default 4)'),
    maxStepsPerRound: z.number().int().min(1).max(100).optional().describe('Max taps per round (default 30)'),
  },
}, async ({ rounds, maxStepsPerRound }) => {
  try {
    if (device) throw new Error('auto_test only runs in headless mode: it taps every control, which is not safe on a real phone. Call use_target with target="headless" to run it, or exercise the device manually with click_screen / type_text.');
    const s = needSession();
    const { summary, shots } = await autoTest(s, { rounds, maxStepsPerRound });
    const content = [{ type: 'text', text: summary }];
    for (const sh of shots) {
      content.push({ type: 'text', text: 'Screenshot: ' + sh.caption });
      content.push({ type: 'image', data: sh.png.toString('base64'), mimeType: 'image/png' });
    }
    return { content };
  } catch (e) {
    return failure(e);
  }
});

// Everything the AI could test on: Android emulators/phones (adb) and booted iOS simulators (macOS).
const gather = async () => {
  const { adb, devices } = await listDevices();
  const ios = await listSimulators();
  const tools = ios.available ? await iosToolsAvailable() : { mac: false };
  const android = devices.map((d) => ({ ...d, platform: 'android' }));
  return { adb, android, ios, tools, all: [...android, ...ios.sims.filter((x) => x.state === 'device')] };
};

const describeTarget = (d) => {
  if (d.platform === 'ios') return '- ' + d.serial + ' — iOS Simulator ' + d.model + ' (' + d.runtime + ') — booted';
  return '- ' + d.serial + ' — ' + (d.emulator ? 'Android emulator' : 'Android phone (' + d.usb + ')') + ' ' + d.model + ' — state: ' + d.state + (stateGuidance(d) ? '\n  ' + stateGuidance(d) : '');
};

const nothingConnected = (g) => {
  const lines = ['No Android device/emulator or booted iOS Simulator is connected. Nothing was changed.',
    'Tell the user nothing is connected and recommend they check the app themselves (run "npx expo start" and open it in Expo Go), or continue with headless testing.'];
  if (!g.adb) lines.push('', NO_ADB_HELP);
  else lines.push('', USB_DEBUGGING_HELP);
  if (!g.ios.available) lines.push('', IOS_UNAVAILABLE);
  else if (g.ios.sims.length) lines.push('', 'iOS Simulators exist but none is booted; the user can boot one from Xcode / the Simulator app.');
  return lines.join('\n');
};

server.registerTool('device_list', {
  description: 'Lists connected Android emulators / USB phones (adb) and booted iOS Simulators (macOS only) and tells what, if anything, must be done before they can be used (USB debugging, authorization, idb). Read-only: changes nothing. If nothing is connected, tell the user and recommend they check the app themselves. Physical iPhones cannot be driven.',
  inputSchema: {},
}, async () => {
  try {
    const g = await gather();
    if (!g.android.length && !g.all.length) return { content: [{ type: 'text', text: nothingConnected(g) }] };
    const lines = g.all.map(describeTarget);
    const needIdb = g.all.some((d) => d.platform === 'ios') && !g.tools.idb;
    if (needIdb) lines.push('', IDB_HELP);
    const usable = g.all.filter((d) => d.state === 'device' && (d.platform !== 'ios' || g.tools.idb));
    lines.push('', usable.length
      ? 'Usable targets exist. If the user wants device testing, tell them (for a physical Android phone) that you will tap, type and scroll on it, then call use_target with target="device".'
      : 'No target is ready yet.');
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  } catch (e) {
    return failure(e);
  }
});

server.registerTool('use_target', {
  description: 'Chooses where the app is tested: "headless" (default, built-in renderer) or "device" (Expo Go on an Android emulator / USB phone via adb, or a booted iOS Simulator on macOS). Selecting "device" first asks the user for consent to control a physical phone, to install Expo Go if missing, and to replace an Expo Go whose SDK does not match the project; then starts the Expo dev server and opens the app. If the user declines, nothing is changed.',
  inputSchema: {
    target: z.enum(['headless', 'device']),
    serial: z.string().optional().describe('adb serial or iOS simulator UDID from device_list (needed if several targets are ready)'),
    projectPath: z.string().optional(),
    confirmed: z.array(z.string()).optional().describe('Consent keys the user approved in chat (only when a previous call asked you to relay a question)'),
  },
}, async ({ target, serial, projectPath, confirmed }) => {
  try {
    for (const k of confirmed || []) granted.add(k);
    if (target === 'headless') {
      device?.stop();
      device = null;
      return { content: [{ type: 'text', text: 'Back to headless mode (device dev server stopped).' }] };
    }
    const g = await gather();
    if (!g.all.length && !g.android.length) return { content: [{ type: 'text', text: nothingConnected(g) }] };
    const pool = [...g.android, ...g.all.filter((d) => d.platform === 'ios')];
    const ready = pool.filter((d) => d.state === 'device');
    const pick = serial ? pool.find((d) => d.serial === serial) : ready.length === 1 ? ready[0] : pool.length === 1 ? pool[0] : null;
    if (!pick) {
      const why = serial ? 'No such device: ' + serial + '.' : ready.length ? 'Several targets are ready; pass serial.' : 'No target is ready.';
      return { content: [{ type: 'text', text: why + '\n' + pool.map(describeTarget).join('\n') }] };
    }
    if (pick.state !== 'device') return { content: [{ type: 'text', text: (stateGuidance(pick) || 'Not ready.') + '\n\n' + USB_DEBUGGING_HELP }] };
    if (pick.platform === 'ios' && !g.tools.idb) return { content: [{ type: 'text', text: IDB_HELP + '\nNothing was changed.' }] };

    const project = projectPath || session?.project || DEFAULT_PROJECT;
    const d = pick.platform === 'ios' ? new IosSimulator(pick, project) : new Device(pick, project);
    if (d.physical) {
      await ask('I am about to CONTROL your phone "' + (pick.model || pick.serial) + '": I will take screenshots and tap, type and scroll inside Expo Go while testing your app. Keep it unlocked and do not touch it meanwhile. Allow?', 'control:' + pick.serial);
    }
    const go = await d.ensureExpoGo(ask);
    await d.startMetro(ask);
    device?.stop();
    device = d;
    await device.reload();
    await device.screenshot();
    deviceMark = device.metroLog.length;
    const kind = pick.platform === 'ios' ? 'iOS Simulator' : pick.emulator ? 'Android emulator' : 'Android phone';
    return await devReply('Device mode: ' + (pick.model || pick.serial) + ' (' + kind + '), Expo Go ' + go.version + (go.installed ? ' (just installed)' : '') + ', project ' + project + '. Tools now act on the device.');
  } catch (e) {
    if (e instanceof UserDecision) return decisionReply(e);
    return failure(e);
  }
});

server.registerTool('press_key', {
  description: 'Device mode only: presses a hardware key inside Expo Go. Allowed: back (Android only), enter, tab, delete.',
  inputSchema: { key: z.enum(['back', 'enter', 'tab', 'delete']) },
}, async ({ key }) => {
  try {
    needDevice();
    await device.key(key);
    await sleep(700);
    return await devReply('Pressed ' + key + '.');
  } catch (e) {
    return failure(e);
  }
});

server.registerPrompt('verify_changes', {
  description: 'Rebuild the app and verify that everything you just added or changed really works.',
}, () => ({
  messages: [{ role: 'user', content: { type: 'text', text: 'Verify the app on screen: refresh_screen, exercise every feature I just added or changed (click, type valid and invalid data, scroll), run auto_test, fix any problems you find and repeat until a full pass is clean. Then report what you checked.' } }],
}));

await server.connect(new StdioServerTransport());
