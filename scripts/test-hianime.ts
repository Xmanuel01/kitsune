// Small test script to initialize the HiAnime scraper and call getEpisodeSources
// Run with: bun run ./scripts/test-hianime.ts

// Optional: if you want to load .env values, install `dotenv` and uncomment the line below
// import 'dotenv/config';
import path from 'path';

// Import the lazy getter directly
import { getHiAnimeScraper, hianime } from '../src/lib/hianime';

async function run() {
  try {
    console.log('Starting HiAnime scraper test');

    const scraper = await getHiAnimeScraper();
    console.log('getHiAnimeScraper returned:', scraper ? 'instance' : 'null');

    if (!scraper) {
      console.log('Scraper unavailable, aborting test');
      return;
    }

    const testId = process.env.TEST_EPISODE_ID || 'naruto-shippuden-355?ep=7882';
    console.log('Calling getEpisodeSources with id:', testId);

    try {
      // Use the compatibility proxy or direct method
      const result = (hianime.getEpisodeSources)
        ? await hianime.getEpisodeSources(testId, undefined, 'sub')
        : await scraper.getEpisodeSources(testId, undefined, 'sub');

      console.log('getEpisodeSources result summary:', Array.isArray(result) ? `array(${result.length})` : typeof result);
      console.dir(result, { depth: 3 });
    } catch (callErr) {
      console.error('Error calling getEpisodeSources:', callErr);
    }
  } catch (err) {
    console.error('Unexpected error in test script:', err);
  }
}

run();
