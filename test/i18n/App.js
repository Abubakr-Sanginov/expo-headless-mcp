import React from 'react';
import { View, Text } from 'react-native';
export default () => (
  <View style={{ flex: 1, padding: 24, paddingTop: 60, backgroundColor: '#fff' }}>
    {['English: Hello world', 'Русский: Привет, мир! Длинный текст для переноса строки', '中文：你好，世界', '日本語：こんにちは世界', '한국어: 안녕하세요', 'العربية: مرحبا بالعالم', 'עברית: שלום עולם', 'हिन्दी: नमस्ते दुनिया', 'Emoji: 😀🚀❤️ Ñandú ü ß'].map((t) => <Text key={t} style={{ fontSize: 18, marginBottom: 10 }}>{t}</Text>)}
  </View>
);
