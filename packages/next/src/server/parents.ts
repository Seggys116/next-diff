// Origin that opened each preview. The inspector posts only there, and only that origin may frame it. Memory only.
type Store = Map<string, string>;
const g = globalThis as unknown as { __diffParents?: Store };
const store: Store = (g.__diffParents ??= new Map());

export function rememberParent(label: string, origin: string) {
  store.set(label, origin);
  // Sessions expire on their own (lib/proxy/sessions.ts); this only needs to not grow without bound.
  while (store.size > 64) store.delete(store.keys().next().value as string);
}

export function parentFor(label: string): string | undefined {
  return store.get(label);
}

export function forgetParent(label: string) {
  store.delete(label);
}
