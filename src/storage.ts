import type { BeezIDStorage } from './types';

export class MemoryStorage implements BeezIDStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

export function resolveStorage(storage?: BeezIDStorage): BeezIDStorage {
  if (storage) return storage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return new MemoryStorage();
}
