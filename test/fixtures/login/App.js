import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Switch } from 'react-native';

export default function App() {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [remember, setRemember] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = () => {
    if (!email.includes('@')) return setMsg('Enter a valid email');
    if (pass.length < 6) return setMsg('Password must be at least 6 characters');
    setMsg('Welcome, ' + email + '!');
  };

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Sign in</Text>
      <TextInput testID="email" style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" />
      <TextInput testID="password" style={styles.input} placeholder="Password" secureTextEntry value={pass} onChangeText={setPass} />
      <View style={styles.row}>
        <Text>Remember me</Text>
        <Switch value={remember} onValueChange={setRemember} />
      </View>
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={submit}>
        <Text style={styles.btnText}>Log in</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', padding: 24 },
  title: { fontSize: 32, fontWeight: '700', marginBottom: 24 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  msg: { color: '#d33', marginBottom: 12 },
  button: { backgroundColor: '#2563eb', padding: 14, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
