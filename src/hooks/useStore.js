import { useSyncExternalStore } from 'react';

// Subscribe to a player store; `select` may reduce the value so a component
// re-renders only when the part it shows changes. Selections must be primitives.
export function useStore(store, select = value => value) {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
