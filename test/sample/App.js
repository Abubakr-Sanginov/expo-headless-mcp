import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native';

export default function App() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [count, setCount] = useState(0);
  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Welcome back to the extremely long titled application</Text>
      <TextInput testID="email" style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={() => { if (!email.includes('@')) setError('Invalid email'); else { setError(''); setCount(count + 1); Alert.alert('Hi', email); } }}>
        <Text style={styles.btnText}>Sign in ({count})</Text>
      </TouchableOpacity>
      <View style={{ position: 'absolute', top: 150, left: 40 }}><Text>Overlapping label</Text></View>
      <ScrollView style={{ height: 100, marginTop: 20 }}>
        {Array.from({ length: 20 }, (_, i) => <Text key={i} style={{ padding: 6 }}>Row {i}</Text>)}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 80, backgroundColor: '#f4f6fb' },
  title: { fontSize: 26, fontWeight: 'bold', marginBottom: 20, color: '#1c1c3a' },
  input: { borderWidth: 1, borderColor: '#bbb', borderRadius: 10, padding: 12, backgroundColor: '#fff', fontSize: 16 },
  error: { color: 'crimson', marginTop: 6 },
  button: { marginTop: 16, backgroundColor: '#4f46e5', borderRadius: 12, padding: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
