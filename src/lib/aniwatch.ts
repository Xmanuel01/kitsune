let scraperInstance: any = null;
let initializing: Promise<any> | null = null;

export async function getAniwatchScraper() {
  if (scraperInstance) {
    return scraperInstance;
  }

  if (initializing) {
    return initializing;
  }

  initializing = (async () => {
    try {
      const mod = await import("aniwatch");
      const Scraper = mod?.HiAnime?.Scraper ?? mod?.HiAnime;
      if (!Scraper) {
        throw new Error("aniwatch scraper constructor was not found");
      }
      scraperInstance = new Scraper();
      return scraperInstance;
    } catch (error) {
      console.error("Failed to initialize Aniwatch scraper:", error);
      scraperInstance = null;
      return null;
    } finally {
      initializing = null;
    }
  })();

  return initializing;
}
