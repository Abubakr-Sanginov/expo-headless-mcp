const store = new Map();
const AsyncStorage = {
  getItem: async (k) => (store.has(k) ? store.get(k) : null),
  setItem: async (k, v) => void store.set(k, String(v)),
  removeItem: async (k) => void store.delete(k),
  clear: async () => store.clear(),
  getAllKeys: async () => [...store.keys()],
  multiGet: async (ks) => ks.map((k) => [k, store.has(k) ? store.get(k) : null]),
  multiSet: async (kv) => kv.forEach(([k, v]) => store.set(k, String(v))),
  multiRemove: async (ks) => ks.forEach((k) => store.delete(k)),
};
export default AsyncStorage;
