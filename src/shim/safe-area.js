import React from 'react';
import { View } from './rn.js';
const insets = { top: 47, bottom: 34, left: 0, right: 0 };
export const SafeAreaProvider = ({ children, style }) => React.createElement(View, { style: [{ flex: 1 }, style] }, children);
export const SafeAreaView = ({ children, style, edges }) => React.createElement(View, { style: [{ flex: 1, paddingTop: 47, paddingBottom: 34 }, style] }, children);
export const SafeAreaInsetsContext = React.createContext(insets);
export const useSafeAreaInsets = () => insets;
export const useSafeAreaFrame = () => ({ x: 0, y: 0, width: 390, height: 844 });
export const initialWindowMetrics = { insets, frame: { x: 0, y: 0, width: 390, height: 844 } };
