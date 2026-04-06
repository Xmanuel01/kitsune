// Lazily load and initialize the HiAnime scraper from `aniwatch`.
// Instantiating the scraper eagerly at module import time can spawn
// workers which may crash the Next dev server. We provide a safe
// getter that returns `null` on failure so callers can handle it.

// Use simple `any` types here to avoid complex typeof/type expressions
// which can confuse the dev bundler (Turbopack) during parsing.
let _scraper: any = null;
let _initializing: Promise<any> | null = null;

export async function getHiAnimeScraper() {
	if (_scraper) {
		return _scraper;
	}
	if (_initializing) {
		return _initializing;
	}

	_initializing = (async () => {
		try {
			const mod = await import("aniwatch");
			// `mod.HiAnime.Scraper` is the constructor in current versions
			const Scraper = mod?.HiAnime?.Scraper ?? mod?.HiAnime;
			if (!Scraper) throw new Error("aniwatch HiAnime.Scraper not found");
			_scraper = new Scraper();
			return _scraper;
		} catch (err) {
			console.error("Failed to initialize HiAnime scraper:", err);
			_scraper = null;
			return null;
		} finally {
			_initializing = null;
		}
	})();

	return _initializing;
}

// Compatibility export: provide a `hianime` object that mirrors the
// original scraper API but initializes the real scraper lazily. This
// allows existing imports (`import { hianime } from '@/lib/hianime'`)
// to continue working without changing all call sites.
export const hianime: any = new Proxy(
	{},
	{
 		get(_, prop: string) {
			if (prop === "then") {
				return undefined;
			}
 			return async (...args: any[]) => {
 				const scraper = await getHiAnimeScraper();
 				if (!scraper) {
 					throw new Error('HiAnime scraper unavailable');
 				}
 				const fn = scraper[prop];
 				if (typeof fn !== 'function') {
 					throw new Error(`Scraper method not found: ${prop}`);
 				}
 				try {
 					return await fn.apply(scraper, args);
 				} catch (err) {
 					console.error(`hianime proxy: method ${prop} threw error`, err);
 					throw err;
 				}
 			};
 		},
	},
);
