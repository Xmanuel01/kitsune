// C:\Users\USER\Documents\kitsune\src\app\anime\watch\video-player-section.tsx

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAnimeStore } from "@/store/anime-store";

import { IWatchedAnime } from "@/types/watched-anime";
import KitsunePlayer from "@/components/kitsune-player";
import { AlertCircleIcon, Captions, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuthStore } from "@/store/auth-store";
import { supabase } from "@/lib/supabaseClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/constants/routes";
import { useGetAllEpisodes } from "@/query/get-all-episodes";
import { GOGOANIME_BACKUP_SERVER_NAME } from "@/lib/provider-constants";
import { useGetEpisodePlayerData } from "@/query/get-episode-player-data";

const VideoPlayerSection: React.FC = () => {
  const { selectedEpisode, anime, setSelectedEpisode } = useAnimeStore();
  const router = useRouter();

  const [serverName, setServerName] = useState<string>(() => {
    try {
      const raw = localStorage.getItem("serverPreference");
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.serverName || "";
    } catch {
      return "";
    }
  });
  const [key, setKey] = useState<string>(() => {
    try {
      const raw = localStorage.getItem("serverPreference");
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.key || "sub";
    } catch {
      return "sub";
    }
  });

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

  const [autoNext, setAutoNext] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("autoNext");
      return stored ? JSON.parse(stored) : false;
    } catch {
      return false;
    }
  });

  const {
    data: playerData,
    isLoading,
    isError: isEpisodeDataError,
  } = useGetEpisodePlayerData(
    selectedEpisode,
    serverName || undefined,
    key || "sub",
  );

  const serversData = playerData?.servers;
  const episodeData = playerData?.source;

  useEffect(() => {
    if (!playerData?.selected) return;
    if (playerData.selected.serverName !== serverName) {
      setServerName(playerData.selected.serverName);
    }
    if (playerData.selected.category !== key) {
      setKey(playerData.selected.category);
    }
  }, [key, playerData?.selected, serverName]);

  const animeId = anime?.anime?.info?.id;
  const { data: allEpisodes } = useGetAllEpisodes(animeId);

  const sortedEpisodes = useMemo(() => {
    if (!allEpisodes?.episodes) return [];
    return [...allEpisodes.episodes].sort((a, b) => a.number - b.number);
  }, [allEpisodes]);

  const nextEpisode = useMemo(() => {
    if (!sortedEpisodes.length) return null;
    const currentIdx = sortedEpisodes.findIndex(
      (episode) => episode.episodeId === selectedEpisode,
    );
    if (currentIdx === -1) return null;
    return sortedEpisodes[currentIdx + 1] || null;
  }, [sortedEpisodes, selectedEpisode]);

  const [playerInstance, setPlayerInstance] = useState<any>(null);

  const goToEpisode = useCallback(
    (episodeId: string | undefined) => {
      if (!episodeId || !animeId) return;
      setSelectedEpisode(episodeId);
      router.push(`${ROUTES.WATCH}?anime=${animeId}&episode=${episodeId}`);
    },
    [animeId, router, setSelectedEpisode],
  );

  useEffect(() => {
    if (!playerInstance) return;

    const handleEnded = () => {
      if (!autoNext || !nextEpisode?.episodeId) return;
      goToEpisode(nextEpisode.episodeId);
    };

    playerInstance.on("video:ended", handleEnded);
    return () => {
      playerInstance.off("video:ended", handleEnded);
    };
  }, [autoNext, nextEpisode?.episodeId, goToEpisode, playerInstance]);

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
  if (isLoading || (!episodeData && !isEpisodeDataError)) {
    return (
      <div className="h-auto aspect-video lg:max-h-[calc(100vh-150px)] min-h-[20vh] sm:min-h-[30vh] md:min-h-[40vh] lg:min-h-[60vh] w-full animate-pulse bg-slate-700 rounded-md" />
    );
  }

  if (!episodeData) {
    return (
      <Alert variant="destructive" className="text-red-400">
        <AlertTitle className="font-bold">Episode Unavailable</AlertTitle>
        <AlertDescription>
          We could not load this episode source right now. Try another server,
          including the {GOGOANIME_BACKUP_SERVER_NAME} backup option.
        </AlertDescription>
      </Alert>
    );
  }

  // Safely derive arrays
  const sources = episodeData?.sources ?? [];
  const subServers = serversData?.sub ?? [];
  const dubServers = serversData?.dub ?? [];
  const hasDub = dubServers.length > 0;
  const usingIframeBackup =
    episodeData.provider === "gogoanime" && Boolean(episodeData.iframeUrl);

  // Extract ?ep=... safely for fallback iframe
  const episodeIdRaw = serversData?.episodeId;
  const epParam =
    typeof episodeIdRaw === "string" && episodeIdRaw.includes("?ep=")
      ? episodeIdRaw.split("?ep=")[1]
      : undefined;

  // If no sources, use fallback iframe
  if (episodeData.iframeUrl) {
    return (
      <div>
        <div
          className={
            "relative w-full h-auto aspect-video min-h-[20vh] sm:min-h-[30vh] md:min-h-[40vh] lg:min-h-[60vh] max-h-[500px] lg:max-h-[calc(100vh-150px)] bg-black overflow-hidden"
          }
        >
          <iframe
            title={`Backup video player for episode ${serversData?.episodeNo ?? ""}`}
            src={episodeData.iframeUrl}
            width="100%"
            height="100%"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>

        <div className="mt-4">
          <Alert className="border-amber-500/50 text-amber-100 bg-amber-950/30">
            <AlertTitle className="font-bold">
              {usingIframeBackup && serverName !== GOGOANIME_BACKUP_SERVER_NAME
                ? "Backup Provider Activated"
                : "Gogoanime Backup Provider"}
            </AlertTitle>
            <AlertDescription>
              {usingIframeBackup && serverName !== GOGOANIME_BACKUP_SERVER_NAME
                ? `The ${serverName.toUpperCase()} source was unavailable, so playback was switched to ${GOGOANIME_BACKUP_SERVER_NAME}.`
                : `You are playing this episode through ${GOGOANIME_BACKUP_SERVER_NAME}.`}
            </AlertDescription>
          </Alert>
        </div>

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
        </div>
      </div>
    );
  }

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
        getInstance={(art) => {
          setPlayerInstance(art);
        }}
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

        <div className="flex flex-col items-end space-y-2 text-sm">
          <div className="flex flex-row items-center space-x-2">
            <Switch
              checked={autoSkip}
              onCheckedChange={onHandleAutoSkipChange}
              id="auto-skip"
            />
            <p>Auto Skip</p>
          </div>
          <div className="flex flex-row items-center space-x-2">
            <Switch
              checked={autoNext}
              onCheckedChange={(value) => {
                setAutoNext(value);
                try {
                  localStorage.setItem("autoNext", JSON.stringify(value));
                } catch {
                  // ignore
                }
              }}
              id="auto-next"
            />
            <p>Auto Next</p>
            <Button
              size="sm"
              disabled={!nextEpisode}
              onClick={() => goToEpisode(nextEpisode?.episodeId)}
              className="font-semibold"
            >
              Next Episode
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayerSection;
