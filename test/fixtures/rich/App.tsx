import React, { useEffect, useRef, useState } from 'react';
import { Animated, FlatList, Image, Modal, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';

type Todo = { id: number; title: string; done: boolean };
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const fade = useRef(new Animated.Value(0)).current;
  const { width } = useWindowDimensions();

  useEffect(() => {
    const t = setTimeout(() => {
      setTodos([
        { id: 1, title: 'Buy milk', done: false },
        { id: 2, title: 'Écrire le rapport très long qui doit passer à la ligne suivante', done: true },
      ]);
      setLoading(false);
    }, 50);
    Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    return () => clearTimeout(t);
  }, []);

  const add = () => {
    if (!draft.trim()) return;
    Haptics.impactAsync();
    setTodos((p) => [...p, { id: Date.now(), title: draft.trim(), done: false }]);
    setDraft('');
    setOpen(false);
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <Animated.View style={[styles.header, { opacity: fade }]}>
        <Image source={{ uri: PIXEL }} style={styles.avatar} />
        <Text style={styles.h1}>Todos ({todos.length}) · {Platform.OS} · {Math.round(width)}</Text>
        <Pressable accessibilityLabel="Add todo" onPress={() => setOpen(true)}>
          <Ionicons name="add" size={28} color="#2563eb" />
        </Pressable>
      </Animated.View>
      {loading ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : (
        <FlatList
          data={todos}
          keyExtractor={(t) => String(t.id)}
          ListEmptyComponent={<Text style={styles.muted}>Nothing to do</Text>}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => setTodos((p) => p.map((t) => (t.id === item.id ? { ...t, done: !t.done } : t)))}
            >
              <Text style={[styles.title, item.done && styles.done]}>{item.title}</Text>
              <Text>{item.done ? '✓' : '○'}</Text>
            </Pressable>
          )}
        />
      )}
      <Modal visible={open} transparent animationType="slide">
        <View style={styles.modal}>
          <View style={styles.sheet}>
            <TextInput testID="draft" placeholder="New todo" value={draft} onChangeText={setDraft} onSubmitEditing={add} style={styles.input} />
            <Pressable style={styles.btn} onPress={add}>
              <Text style={styles.btnText}>Save</Text>
            </Pressable>
            <Pressable onPress={() => setOpen(false)}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#ccc' },
  h1: { fontSize: 18, fontWeight: '700', flex: 1, marginHorizontal: 12 },
  muted: { color: '#64748b', textAlign: 'center', marginTop: 40 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, gap: 12 },
  title: { flex: 1, fontSize: 16 },
  done: { textDecorationLine: 'line-through', color: '#94a3b8' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: '#e2e8f0' },
  modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: '#fff', padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 12, fontSize: 16 },
  btn: { backgroundColor: '#2563eb', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 12 },
  btnText: { color: '#fff', fontWeight: '600' },
  cancel: { textAlign: 'center', padding: 12, color: '#64748b' },
});
