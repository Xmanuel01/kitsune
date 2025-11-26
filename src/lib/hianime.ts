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
		console.debug('getHiAnimeScraper: returning cached scraper');
		return _scraper;
	}
	if (_initializing) {
		console.debug('getHiAnimeScraper: initialization already in progress');
		return _initializing;
	}

	_initializing = (async () => {
		console.debug('getHiAnimeScraper: starting initialization');
		try {
			const mod = await import("aniwatch");
			console.debug('getHiAnimeScraper: aniwatch module loaded', { hasHiAnime: Boolean(mod?.HiAnime) });
			// `mod.HiAnime.Scraper` is the constructor in current versions
			const Scraper = mod?.HiAnime?.Scraper ?? mod?.HiAnime;
			if (!Scraper) throw new Error("aniwatch HiAnime.Scraper not found");
			_scraper = new Scraper();
			console.debug('getHiAnimeScraper: scraper instance created');
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
 			return async (...args: any[]) => {
 				console.debug(`hianime proxy: calling method ${prop}`, { args });
 				const scraper = await getHiAnimeScraper();
 				if (!scraper) {
 					console.error(`hianime proxy: scraper unavailable when calling ${prop}`);
 					throw new Error('HiAnime scraper unavailable');
 				}
 				const fn = scraper[prop];
 				if (typeof fn !== 'function') {
 					console.error(`hianime proxy: method not found on scraper: ${prop}`);
 					throw new Error(`Scraper method not found: ${prop}`);
 				}
 				try {
 					const result = await fn.apply(scraper, args);
 					console.debug(`hianime proxy: method ${prop} completed`, { resultSummary: summarize(result) });
 					return result;
 				} catch (err) {
 					console.error(`hianime proxy: method ${prop} threw error`, err);
 					throw err;
 				}
 			};
 		},
	},
);

function summarize(v: any) {
    try {
        if (v == null) return { type: typeof v, value: null };
        if (Array.isArray(v)) return { type: 'array', length: v.length };
        if (typeof v === 'object') return { type: 'object', keys: Object.keys(v).slice(0,5) };
        return { type: typeof v, value: String(v).slice(0,200) };
    } catch (e) {
        return { type: typeof v };
    }
}
