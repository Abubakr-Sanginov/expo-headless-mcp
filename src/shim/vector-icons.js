import React from 'react';
import { Text } from './rn.js';
// Icons render as a labelled glyph placeholder so layout (size/colour) is preserved.
const Icon = ({ name, size = 24, color = '#000', style }) =>
  React.createElement(Text, { style: [{ width: size, height: size, fontSize: size * 0.5, color, textAlign: 'center', lineHeight: size, backgroundColor: 'rgba(128,128,128,0.15)', borderRadius: size / 4 }, style] }, '◆');
const proxy = new Proxy({}, { get: (_t, k) => (k === '__esModule' ? true : Icon) });
export default Icon;
export const Ionicons = Icon, MaterialIcons = Icon, MaterialCommunityIcons = Icon, FontAwesome = Icon, FontAwesome5 = Icon, Feather = Icon, AntDesign = Icon, Entypo = Icon, EvilIcons = Icon, Foundation = Icon, Octicons = Icon, SimpleLineIcons = Icon, Fontisto = Icon, Zocial = Icon;
