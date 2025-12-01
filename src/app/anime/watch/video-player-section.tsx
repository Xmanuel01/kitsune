// C:\Users\USER\Documents\kitsune\src\app\anime\watch\video-player-section.tsx

"use client";

import React, { useEffect, useState } from "react";
import { useAnimeStore } from "@/store/anime-store";

import { IWatchedAnime } from "@/types/watched-anime";
import KitsunePlayer from "@/components/kitsune-player";
import { useGetEpisodeData } from "@/query/get-episode-data";
import { useGetEpisodeServers } from "@/query/get-episode-servers";
import { getFallbackServer } from "@/utils/fallback-server";
import { AlertCircleIcon, Captions, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuthStore } from "@/store/auth-store";
import { supabase } from "@/lib/supabaseClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const VideoPlayerSection: React.FC = () => {
  const { selectedEpisode, anime } = useAnimeStore();

  const { data: serversData } = useGetEpisodeServers(selectedEpisode);

  const [serverName, setServerName] = useState<string>("");
  const [key, setKey] = useState<string>("");

  const { auth, setAuth } = useAuthStore();

  const [autoSkip, setAutoSkip] = useState<boolean>(() => {
    try {
      if (auth?.autoSkip !== undefined) return auth.autoSkip;
      const stored = localStorage.getItem("autoSkip");
      return stored ? JSON.parse(stored) : false;
    } catch {
      return false;
    }
  });

  // Safely derive serverName/key from serversData
  useEffect(() => {
    if (!serversData) return;
    const { serverName, key } = getFallbackServer(serversData);
    setServerName(serverName);
    setKey(key);
  }, [serversData]);

  const { data: episodeData, isLoading } = useGetEpisodeData(
    selectedEpisode,
    serverName,
    key,
  );

  const [watchedDetails, setWatchedDetails] = useState<Array<IWatchedAnime>>(
    () => {
      try {
        const raw = localStorage.getItem("watched");
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
  );


  function changeServer(nextServerName: string, nextKey: string) {
    setServerName(nextServerName);
    setKey(nextKey);
    try {
      const preference = { serverName: nextServerName, key: nextKey };
      localStorage.setItem("serverPreference", JSON.stringify(preference));
    } catch {
      // ignore storage errors
    }
  }

  async function onHandleAutoSkipChange(value: boolean) {
    setAutoSkip(value);
    if (!auth) {
      try {
        localStorage.setItem("autoSkip", JSON.stringify(value));
      } catch {
        // ignore
      }
      return;
    }
    // Persist preference to user metadata in Supabase Auth
    const { error } = await supabase.auth.updateUser({
      data: { autoSkip: value },
    });
    if (!error) {
      setAuth({ ...auth, autoSkip: value });
    } else {
      console.error("Failed updating autoSkip metadata", error);
    }
  }

  useEffect(() => {
    if (auth) return;

    if (!Array.isArray(watchedDetails)) {
      localStorage.removeItem("watched");
      return;
    }

    if (episodeData && anime?.anime?.info?.id) {
      const existingAnime = watchedDetails.find(
        (watchedAnime) => watchedAnime.anime.id === anime.anime.info.id,
      );

      if (!existingAnime) {
        const updatedWatchedDetails: IWatchedAnime[] = [
          ...watchedDetails,
          {
            anime: {
              id: anime.anime.info.id,
              title: anime.anime.info.name,
              poster: anime.anime.info.poster,
            },
            episodes: [selectedEpisode],
          },
        ];
        localStorage.setItem("watched", JSON.stringify(updatedWatchedDetails));
        setWatchedDetails(updatedWatchedDetails);
      } else {
        const episodeAlreadyWatched =
          existingAnime.episodes.includes(selectedEpisode);

        if (!episodeAlreadyWatched) {
          const updatedWatchedDetails: IWatchedAnime[] = watchedDetails.map(
            (watchedAnime) =>
              watchedAnime.anime.id === anime.anime.info.id
                ? {
                    ...watchedAnime,
                    episodes: [
                      ...watchedAnime.episodes,
                      selectedEpisode,
                    ],
                  }
                : watchedAnime,
          );

          localStorage.setItem(
            "watched",
            JSON.stringify(updatedWatchedDetails),
          );
          setWatchedDetails(updatedWatchedDetails);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeData, selectedEpisode, auth]);

  // Normal loading skeleton
  if (isLoading || !episodeData) {
    return (
      <div className="h-auto aspect-video lg:max-h-[calc(100vh-150px)] min-h-[20vh] sm:min-h-[30vh] md:min-h-[40vh] lg:min-h-[60vh] w-full animate-pulse bg-slate-700 rounded-md" />
    );
  }

  // Safely derive arrays
  const sources = episodeData?.sources ?? [];
  const subServers = serversData?.sub ?? [];
  const dubServers = serversData?.dub ?? [];
  const hasDub = dubServers.length > 0;

  // Extract ?ep=... safely for fallback iframe
  const episodeIdRaw = serversData?.episodeId;
  const epParam =
    typeof episodeIdRaw === "string" && episodeIdRaw.includes("?ep=")
      ? episodeIdRaw.split("?ep=")[1]
      : undefined;

  // If no sources, use fallback iframe
  if (!sources.length) {
    return (
      <>
        <div
          className={
            "relative w-full h-auto aspect-video  min-h-[20vh] sm:min-h-[30vh] md:min-h-[40vh] lg:min-h-[60vh] max-h-[500px] lg:max-h-[calc(100vh-150px)] bg-black overflow-hidden p-4"
          }
        >
          {epParam ? (
            <iframe
              title={`Video player for episode ${epParam}`}
              src={`https://megaplay.buzz/stream/s-2/${epParam}/sub`}
              width="100%"
              height="100%"
              allowFullScreen
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-slate-200">
              Episode source is temporarily unavailable. Please try again later.
            </div>
          )}
        </div>
        <div className="mt-4">
          <Alert variant="destructive" className="text-red-400">
            <AlertTitle className="font-bold flex items-center space-x-2">
              <AlertCircleIcon size={20} />
              <p>Fallback Video Player Activated</p>
            </AlertTitle>
            <AlertDescription>
              The original video source for this episode is currently
              unavailable. A fallback player has been provided for your
              convenience. We recommend using an ad blocker for a smoother
              viewing experience.
            </AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  return (
    <div>
      <KitsunePlayer
        key={sources[0]?.url ?? ""}
        episodeInfo={episodeData}
        serversData={serversData!}
        animeInfo={{
          id: anime.anime.info.id,
          title: anime.anime.info.name,
          image: anime.anime.info.poster,
        }}
        subOrDub={key as "sub" | "dub"}
        autoSkip={autoSkip}
      />

      <div className="flex flex-row bg-[#0f172a] items-start justify-between w-full p-5">
        <div>
          <div className="flex flex-row items-center space-x-5">
            <Captions className="text-red-300" />
            <p className="font-bold text-sm">SUB</p>
            {subServers.map((s, i) => (
              <Button
                size="sm"
                key={i}
                className={`uppercase font-bold ${
                  serverName === s.serverName &&
                  key === "sub" &&
                  "bg-red-300"
                }`}
                onClick={() => changeServer(s.serverName, "sub")}
              >
                {s.serverName}
              </Button>
            ))}
          </div>

          {hasDub && (
            <div className="flex flex-row items-center space-x-5 mt-2">
              <Mic className="text-green-300" />
              <p className="font-bold text-sm">DUB</p>
              {dubServers.map((s, i) => (
                <Button
                  size="sm"
                  key={i}
                  className={`uppercase font-bold ${
                    serverName === s.serverName &&
                    key === "dub" &&
                    "bg-green-300"
                  }`}
                  onClick={() => changeServer(s.serverName, "dub")}
                >
                  {s.serverName}
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-row items-center space-x-2 text-sm">
          <Switch
            checked={autoSkip}
            onCheckedChange={onHandleAutoSkipChange}
            id="auto-skip"
          />
          <p>Auto Skip</p>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayerSection;
