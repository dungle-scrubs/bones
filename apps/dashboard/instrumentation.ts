/**
 * Next.js instrumentation file - runs before the app starts.
 *
 * Node.js 25 has experimental localStorage that's broken when
 * --localstorage-file isn't properly configured. This polyfills
 * it with a no-op implementation to prevent SSR errors.
 */
export async function register() {
	if (typeof globalThis.localStorage !== "undefined") {
		// Check if localStorage methods are broken
		const needsPolyfill =
			typeof globalThis.localStorage.getItem !== "function" ||
			typeof globalThis.localStorage.setItem !== "function";

		if (needsPolyfill) {
			const storage = new Map<string, string>();
			globalThis.localStorage = {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value),
				removeItem: (key: string) => storage.delete(key),
				clear: () => storage.clear(),
				get length() {
					return storage.size;
				},
				key: (index: number) => {
					const keys = Array.from(storage.keys());
					return keys[index] ?? null;
				},
			};
		}
	}
}
