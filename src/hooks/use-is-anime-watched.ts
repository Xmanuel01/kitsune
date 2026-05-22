import { useState, useEffect } from "react";
import { IWatchedAnime } from "@/types/watched-anime";
import { WatchHistory } from "./use-get-bookmark";

export const useHasAnimeWatched = (
  animeId: string,
  episodeId?: string,
  watchedEpisodes?: WatchHistory[],
) => {
  const [hasWatchedAnime, setHasWatchedAnime] = useState(false);
  const [hasWatchedEpisode, setHasWatchedEpisode] = useState(false);
  const [watchProgress, setWatchProgress] = useState(0);

  useEffect(() => {
    const updateWatchedState = () => {
      const watchedDetails: Array<IWatchedAnime> =
        JSON.parse(localStorage.getItem("watched") as string) || [];

      if (!Array.isArray(watchedDetails)) {
        localStorage.removeItem("watched");
        return;
      }

      const anime = watchedDetails.find(
        (watchedAnime) => watchedAnime.anime.id === animeId,
      );

      let localProgress = 0;
      if (episodeId) {
        try {
          const rawProgress = localStorage.getItem("watch-progress");
          const progress = rawProgress ? JSON.parse(rawProgress) : {};
          const episodeProgress = progress?.[animeId]?.[episodeId];
          const current = Number(episodeProgress?.current) || 0;
          const duration = Number(episodeProgress?.timestamp) || 0;
          localProgress = duration > 0 ? Math.min(100, Math.round((current / duration) * 100)) : 0;
        } catch {
          localProgress = 0;
        }
      }

      if (anime) {
        setHasWatchedAnime(true);
        if (episodeId) {
          const episodeWatched = anime.episodes.includes(episodeId);
          setHasWatchedEpisode(episodeWatched);
          setWatchProgress(localProgress || (episodeWatched ? 100 : 0));
        }
      } else {
        setHasWatchedAnime(false);
        setHasWatchedEpisode(false);
        setWatchProgress(localProgress);
      }
    };

    updateWatchedState();

    window.addEventListener("storage", updateWatchedState);
    window.addEventListener("kitsune-watch-progress", updateWatchedState);

    return () => {
      window.removeEventListener("storage", updateWatchedState);
      window.removeEventListener("kitsune-watch-progress", updateWatchedState);
    };
  }, [animeId, episodeId]);

  if (watchedEpisodes && watchedEpisodes.length > 0) {
    if (episodeId) {
      const episodeWatchedRecord = watchedEpisodes.find(
        (episode) => episode.episodeId === episodeId,
      );
      const current = Number(episodeWatchedRecord?.current) || 0;
      const duration = Number(episodeWatchedRecord?.timestamp) || 0;
      const watchedProgress = duration > 0 ? Math.min(100, Math.round((current / duration) * 100)) : 0;
      return {
        hasWatchedAnime: true,
        hasWatchedEpisode: Boolean(episodeWatchedRecord),
        watchProgress: watchedProgress || (episodeWatchedRecord ? 100 : 0),
      };
    }
  }

  return { hasWatchedAnime, hasWatchedEpisode, watchProgress };
};
