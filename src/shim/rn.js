// A lightweight stand-in for "react-native" that renders into our own host
// tree (see reconciler.js) instead of native views.
import React, { useState, useEffect, useRef, useCallback, useMemo, forwardRef } from 'react';

const h = React.createElement;
const state = (globalThis.__rnState ||= { alerts: [], size: { width: 390, height: 844, scale: 2 }, root: null });

export const StyleSheet = {
  create: (s) => s,
  flatten: (s) => {
    const out = {};
    const walk = (x) => (Array.isArray(x) ? x.forEach(walk) : x && Object.assign(out, x));
    walk(s);
    return out;
  },
  compose: (a, b) => [a, b],
  hairlineWidth: 1,
  absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
};

export const Platform = {
  OS: 'ios',
  Version: '17.0',
  isPad: false,
  isTV: false,
  select: (o) => (o && ('ios' in o ? o.ios : 'native' in o ? o.native : o.default)),
};

const dims = () => ({ width: state.size.width, height: state.size.height, scale: state.size.scale, fontScale: 1 });
export const Dimensions = {
  get: () => dims(),
  addEventListener: () => ({ remove() {} }),
  removeEventListener() {},
};
export const useWindowDimensions = () => dims();
export const PixelRatio = { get: () => state.size.scale, getFontScale: () => 1, roundToNearestPixel: (n) => Math.round(n), getPixelSizeForLayoutSize: (n) => n * state.size.scale };
export const useColorScheme = () => 'light';
export const Appearance = { getColorScheme: () => 'light', addChangeListener: () => ({ remove() {} }) };

export const Alert = {
  alert: (title, message, buttons) => {
    state.alerts.push({ title, message, buttons: (buttons || [{ text: 'OK' }]).map((b) => b.text) });
    state.lastAlertButtons = buttons || [];
  },
  prompt: (title, message) => state.alerts.push({ title, message, prompt: true }),
};
export const Keyboard = { dismiss() {}, addListener: () => ({ remove() {} }), removeAllListeners() {} };
export const Linking = {
  openURL: async (url) => state.alerts.push({ title: 'Linking.openURL', message: url }),
  canOpenURL: async () => true,
  getInitialURL: async () => null,
  addEventListener: () => ({ remove() {} }),
};
export const AppState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
export const BackHandler = { addEventListener: () => ({ remove() {} }), exitApp() {} };
export const Vibration = { vibrate() {}, cancel() {} };
export const Share = { share: async () => ({ action: 'dismissedAction' }) };
export const NativeModules = {};
export const UIManager = { setLayoutAnimationEnabledExperimental() {} };
export const LayoutAnimation = { configureNext() {}, create: () => ({}), Presets: { easeInEaseOut: {}, linear: {}, spring: {} } };
export const I18nManager = { isRTL: false, allowRTL() {}, forceRTL() {} };
export const AccessibilityInfo = { isScreenReaderEnabled: async () => false, addEventListener: () => ({ remove() {} }), announceForAccessibility() {} };
export const PermissionsAndroid = { PERMISSIONS: {}, RESULTS: {}, request: async () => 'granted', check: async () => true };
export const InteractionManager = { runAfterInteractions: (f) => Promise.resolve(f && f()) };
export const AppRegistry = {
  registerComponent: (_name, getComponent) => {
    state.root = getComponent();
  },
  runApplication() {},
};
export const findNodeHandle = () => null;
export const requireNativeComponent = () => View;
export const processColor = (c) => c;
export const StatusBar = () => null;
StatusBar.setBarStyle = StatusBar.setHidden = StatusBar.setBackgroundColor = () => {};
export const RefreshControl = () => null;

const withRef = (type, extra) =>
  forwardRef((props, ref) => h(type, { ...props, ...(typeof extra === 'function' ? extra(props) : extra), ref: undefined }, props.children));

export const View = withRef('rn-view');
export const SafeAreaView = forwardRef((props, ref) =>
  h('rn-view', { ...props }, props.children && h('rn-view', { style: [{ flex: 1, paddingTop: 47, paddingBottom: 34 }] }, props.children)),
);
// SafeAreaView must apply the user's style on the outer node and padding inside, so fill/background carry through.
export const KeyboardAvoidingView = View;
export const Text = forwardRef((props, ref) => h('rn-text', props, props.children));
export const Image = forwardRef((props, ref) => h('rn-image', props));
export const ImageBackground = forwardRef((props, ref) =>
  h('rn-view', { style: props.style }, h('rn-image', { ...props.imageProps, source: props.source, resizeMode: props.resizeMode, style: [StyleSheet.absoluteFill, props.imageStyle] }), props.children),
);
export const ActivityIndicator = ({ size, color, animating = true, style }) => (animating ? h('rn-spinner', { size, color, style }) : null);

const Touchable = forwardRef((props, ref) => {
  const { children, style, activeOpacity, ...rest } = props;
  return h('rn-view', { ...rest, __pressable: true, style }, typeof children === 'function' ? children({ pressed: false }) : children);
});
export const TouchableOpacity = Touchable;
export const TouchableHighlight = Touchable;
export const TouchableWithoutFeedback = Touchable;
export const TouchableNativeFeedback = Touchable;
Touchable.SelectableBackground = () => ({});
export const Pressable = forwardRef((props, ref) => {
  const { children, style, ...rest } = props;
  const s = typeof style === 'function' ? style({ pressed: false }) : style;
  return h('rn-view', { ...rest, __pressable: true, style: s }, typeof children === 'function' ? children({ pressed: false }) : children);
});

export const Button = ({ title, onPress, color, disabled, testID }) =>
  h('rn-view', { __pressable: true, onPress, disabled, testID, accessibilityLabel: title, style: { padding: 8, opacity: disabled ? 0.4 : 1 } },
    h('rn-text', { style: { color: color || '#007AFF', fontSize: 18, textAlign: 'center' } }, title));

export const TextInput = forwardRef((props, ref) => {
  const [inner, setInner] = useState(props.defaultValue ?? '');
  const value = props.value ?? inner;
  const onChangeText = (t) => {
    setInner(t);
    props.onChangeText && props.onChangeText(t);
    props.onChange && props.onChange({ nativeEvent: { text: t } });
  };
  return h('rn-textinput', { ...props, value, onChangeText, style: [{ fontSize: 14, color: '#000' }, props.style] });
});

export const Switch = ({ value, onValueChange, disabled, trackColor, thumbColor, style }) => {
  const on = !!value;
  const track = on ? (trackColor && trackColor.true) || '#34C759' : (trackColor && trackColor.false) || '#d1d1d6';
  return h('rn-view', { __pressable: true, __switch: true, disabled, accessibilityRole: 'switch', onPress: () => onValueChange && onValueChange(!on),
      style: [{ width: 51, height: 31, borderRadius: 16, backgroundColor: track, padding: 2, justifyContent: 'center', alignItems: on ? 'flex-end' : 'flex-start', opacity: disabled ? 0.5 : 1 }, style] },
    h('rn-view', { style: { width: 27, height: 27, borderRadius: 14, backgroundColor: thumbColor || '#fff', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } } }));
};

export const Modal = ({ visible = true, children, transparent }) =>
  visible ? h('rn-view', { __modal: true, style: [StyleSheet.absoluteFill, { backgroundColor: transparent ? 'transparent' : '#fff', zIndex: 1000 }] }, children) : null;

export const ScrollView = forwardRef((props, ref) => {
  const { horizontal, contentContainerStyle, children, style, refreshControl, ...rest } = props;
  return h('rn-view', { ...rest, __scroll: horizontal ? 'h' : 'v', style: [{ overflow: 'scroll' }, horizontal ? { flexGrow: 0 } : { flexGrow: 1, flexShrink: 1 }, style] },
    h('rn-view', { style: [horizontal ? { flexDirection: 'row' } : null, contentContainerStyle] }, children));
});

export const FlatList = forwardRef((props, ref) => {
  const { data, renderItem, keyExtractor, ItemSeparatorComponent, ListHeaderComponent, ListFooterComponent, ListEmptyComponent, numColumns = 1, horizontal, contentContainerStyle, columnWrapperStyle, ...rest } = props;
  const comp = (C) => (C ? (typeof C === 'function' ? h(C) : C) : null);
  const items = Array.from(data || []);
  const cells = items.map((item, index) => h(React.Fragment, { key: keyExtractor ? keyExtractor(item, index) : item?.id ?? item?.key ?? index }, renderItem({ item, index, separators: {} }), ItemSeparatorComponent && index < items.length - 1 ? h(ItemSeparatorComponent) : null));
  let body = cells;
  if (numColumns > 1 && !horizontal) {
    body = [];
    for (let i = 0; i < items.length; i += numColumns)
      body.push(h('rn-view', { key: i, style: [{ flexDirection: 'row' }, columnWrapperStyle] }, items.slice(i, i + numColumns).map((item, j) =>
        h('rn-view', { key: j, style: { flex: 1 } }, renderItem({ item, index: i + j, separators: {} })))));
  }
  return h(ScrollView, { ...rest, horizontal, contentContainerStyle },
    comp(ListHeaderComponent), items.length ? body : comp(ListEmptyComponent), comp(ListFooterComponent));
});
export const VirtualizedList = FlatList;
export const SectionList = forwardRef((props, ref) => {
  const { sections = [], renderItem, renderSectionHeader, renderSectionFooter, keyExtractor, ItemSeparatorComponent, ...rest } = props;
  return h(ScrollView, rest, sections.map((section, si) => h(React.Fragment, { key: si },
    renderSectionHeader ? renderSectionHeader({ section }) : null,
    section.data.map((item, index) => h(React.Fragment, { key: keyExtractor ? keyExtractor(item, index) : index }, (section.renderItem || renderItem)({ item, index, section, separators: {} }), ItemSeparatorComponent && index < section.data.length - 1 ? h(ItemSeparatorComponent) : null)),
    renderSectionFooter ? renderSectionFooter({ section }) : null)));
});

// ---- Animated: values resolve instantly, animations complete immediately ----
class AnimatedValue {
  constructor(v) { this._v = v; this._l = []; }
  setValue(v) { this._v = v; this._l.forEach((f) => f({ value: v })); }
  setOffset() {}
  flattenOffset() {}
  extractOffset() {}
  addListener(f) { this._l.push(f); return String(this._l.length); }
  removeListener() {}
  removeAllListeners() { this._l = []; }
  stopAnimation(cb) { cb && cb(this._v); }
  resetAnimation() {}
  interpolate(cfg) { return new Interpolation(this, cfg); }
  __getValue() { return this._v; }
}
class Interpolation {
  constructor(parent, cfg) { this.parent = parent; this.cfg = cfg; }
  interpolate(cfg) { return new Interpolation(this, cfg); }
  __getValue() {
    const x = this.parent.__getValue();
    const { inputRange: i, outputRange: o } = this.cfg;
    const lerp = (a, b, t) => (typeof a === 'number' ? a + (b - a) * t : t < 0.5 ? a : b);
    if (x <= i[0]) return o[0];
    for (let k = 1; k < i.length; k++) if (x <= i[k]) return lerp(o[k - 1], o[k], (x - i[k - 1]) / (i[k] - i[k - 1]));
    return o[o.length - 1];
  }
}
const anim = (value, toValue, cfg) => ({
  start: (cb) => { value.setValue(toValue); cb && cb({ finished: true }); },
  stop() {}, reset() {},
});
const composite = (list) => ({ start: (cb) => { list.forEach((a) => a.start()); cb && cb({ finished: true }); }, stop() {}, reset() {} });
const animated = (C) => forwardRef((props, ref) => h(C, props));
export const Animated = {
  Value: AnimatedValue,
  ValueXY: class { constructor(v = { x: 0, y: 0 }) { this.x = new AnimatedValue(v.x); this.y = new AnimatedValue(v.y); } },
  timing: (v, c) => anim(v, c.toValue, c),
  spring: (v, c) => anim(v, c.toValue, c),
  decay: (v) => anim(v, v._v),
  sequence: composite, parallel: composite, stagger: (_d, l) => composite(l),
  loop: () => ({ start() {}, stop() {}, reset() {} }),
  delay: () => ({ start: (cb) => cb && cb({ finished: true }) }),
  event: () => () => {},
  add: (a, b) => ({ __getValue: () => a.__getValue() + b.__getValue() }),
  multiply: (a, b) => ({ __getValue: () => a.__getValue() * b.__getValue() }),
  createAnimatedComponent: animated,
  View: animated(View), Text: animated(Text), Image: animated(Image), ScrollView: animated(ScrollView), FlatList: animated(FlatList),
};
export const Easing = new Proxy({}, { get: () => () => (t) => t });
Animated.Easing = Easing;
export const useAnimatedValue = (v) => useRef(new AnimatedValue(v)).current;

export const unstable_batchedUpdates = (f) => f();
export const TurboModuleRegistry = { get: () => null, getEnforcing: () => ({}) };
export const DeviceEventEmitter = { addListener: () => ({ remove() {} }), emit() {} };
export const NativeEventEmitter = class { addListener() { return { remove() {} }; } removeAllListeners() {} };

export default { StyleSheet, Platform, Dimensions, View, Text, Image, ScrollView, TouchableOpacity, Pressable, TextInput, FlatList, Alert, Animated };
