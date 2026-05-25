// C:\Users\USER\Documents\kitsune\src\app\anime\watch\video-player-section.tsx

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnimeStore } from "@/store/anime-store";
import Image from "next/image";
import KitsunePlayer from "@/components/kitsune-player";
import type Artplayer from "artplayer";
import {
  Captions,
  ChevronsLeft,
  ChevronsRight,
  Expand,
  Lightbulb,
  Maximize2,
  Mic,
  Minimize2,
  Plus,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/auth-store";
import { supabase } from "@/lib/supabaseClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/constants/routes";
import { useGetAllEpisodes } from "@/query/get-all-episodes";
import {
  episodePlayerDataQueryKey,
  getEpisodePlayerData,
  useGetEpisodePlayerData,
} from "@/query/get-episode-player-data";
import { useQueryClient } from "@tanstack/react-query";
import loadingImage from "@/assets/genkai.gif";
import styles from "@/components/player.module.css";

const SERVER_DISPLAY_NAMES: Record<string, string> = {
  hd: "Kitsune",
  "hd-1": "Kitsune",
  "fast player": "Tora",
  "fast-player": "Tora",
  "fast_player": "Tora",
  "hd-2": "Tora",
  vidsrc: "Kitsune",
  megacloud: "Tora",
  "t-cloud": "Ryuu",
};

function getServerDisplayName(serverName: string) {
  return SERVER_DISPLAY_NAMES[String(serverName || "").toLowerCase()] || serverName;
}

type PlayerControlBarProps = {
  autoPlay: boolean;
  autoNext: boolean;
  autoSkip: boolean;
  lightOn: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  onToggleExpand: () => void;
  onToggleLight: () => void;
  onToggleAutoPlay: () => void;
  onToggleAutoNext: () => void;
  onToggleAutoSkip: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onAddToList?: () => void;
  onWatchTogether?: () => void;
};

function PlayerControlBar({
  autoPlay,
  autoNext,
  autoSkip,
  lightOn,
  hasPrevious,
  hasNext,
  onToggleExpand,
  onToggleLight,
  onToggleAutoPlay,
  onToggleAutoNext,
  onToggleAutoSkip,
  onPrevious,
  onNext,
  onAddToList,
  onWatchTogether,
}: PlayerControlBarProps) {
  const textControlClass =
    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-none px-0 text-sm font-semibold text-white hover:text-[#ffdc84]";
  const iconControlClass =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-none text-white hover:text-[#ffdc84] disabled:cursor-not-allowed disabled:opacity-40";
  const stateClass = "ml-0.5 text-[#ffdc84]";

  return (
    <div className="flex min-h-11 w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-[#0b0914] px-3 py-1 text-white">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <button type="button" className={textControlClass} onClick={onToggleExpand}>
          <Expand size={16} />
          <span>Expand</span>
        </button>
        <button type="button" className={textControlClass} onClick={onToggleLight}>
          <Lightbulb size={16} />
          <span>Light</span>
          <span className={stateClass}>{lightOn ? "On" : "Off"}</span>
        </button>
        <button type="button" className={textControlClass} onClick={onToggleAutoPlay}>
          <span>Auto Play</span>
          <span className={stateClass}>{autoPlay ? "On" : "Off"}</span>
        </button>
        <button type="button" className={textControlClass} onClick={onToggleAutoNext}>
          <span>Auto Next</span>
          <span className={stateClass}>{autoNext ? "On" : "Off"}</span>
        </button>
        <button type="button" className={textControlClass} onClick={onToggleAutoSkip}>
          <span>Auto Skip Intro</span>
          <span className={stateClass}>{autoSkip ? "On" : "Off"}</span>
        </button>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={iconControlClass}
          onClick={onPrevious}
          disabled={!hasPrevious}
          aria-label="Previous episode"
          title="Previous episode"
        >
          <ChevronsLeft size={25} fill="currentColor" />
        </button>
        <button
          type="button"
          className={iconControlClass}
          onClick={onNext}
          disabled={!hasNext}
          aria-label="Next episode"
          title="Next episode"
        >
          <ChevronsRight size={25} fill="currentColor" />
        </button>
        <button
          type="button"
          className={iconControlClass}
          onClick={onAddToList}
          aria-label="Add to list"
          title="Add to list"
        >
          <Plus size={27} strokeWidth={3} />
        </button>
        <button
          type="button"
          className={`${iconControlClass} text-[#ffdc84]`}
          onClick={onWatchTogether}
          aria-label="Watch together"
          title="Watch together"
        >
          <Radio size={22} />
        </button>
      </div>
    </div>
  );
}

function BrandedPlayerFallback({
  src,
  title,
  poster,
  className = "",
}: {
  src?: string;
  title: string;
  poster?: string;
  className?: string;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const playerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsLoaded(false);
  }, [src]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === playerRef.current);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    const player = playerRef.current;
    if (!player) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      await player.requestFullscreen();
    } catch (error) {
      console.error("Failed to toggle iframe fullscreen:", error);
    }
  };

  return (
    <div
      ref={playerRef}
      className={`relative w-full h-auto aspect-video min-h-[20vh] sm:min-h-[30vh] md:min-h-[40vh] lg:min-h-[60vh] max-h-[500px] lg:max-h-[calc(100vh-150px)] bg-black overflow-hidden fullscreen:max-h-none fullscreen:h-screen fullscreen:aspect-auto ${className}`}
    >
      {src ? (
        <iframe
          title={title}
          src={src}
          width="100%"
          height="100%"
          allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          referrerPolicy="no-referrer"
          scrolling="no"
          className={`relative z-10 h-full w-[calc(100%+18px)] transition-opacity duration-300 ${
            isLoaded ? "opacity-100" : "opacity-0"
          }`}
          style={{ border: 0, overflow: "hidden" }}
          onLoad={() => setIsLoaded(true)}
        />
      ) : null}

      {src ? (
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          onClick={toggleFullscreen}
          className="absolute right-3 top-3 z-30 h-9 w-9 animate-pulse rounded-full bg-red-600 text-white ring-2 ring-red-300 hover:bg-red-700"
        >
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </Button>
      ) : null}

      <div
        className={`absolute inset-0 z-20 transition-opacity duration-300 ${
          isLoaded ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <div
          className={`${styles.loadingBackground} relative h-full w-full`}
          style={
            poster ? ({ ["--bg-image" as any]: `url(${poster})` } as React.CSSProperties) : undefined
          }
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
          <Image
            src={loadingImage.src}
            alt="Loading player"
            width={60}
            height={60}
            priority
            className={`${styles.loadingImage} relative z-10`}
          />
        </div>
      </div>
    </div>
  );
}

const VideoPlayerSection: React.FC = () => {
  const { selectedEpisode, anime, setSelectedEpisode } = useAnimeStore();
  const router = useRouter();
  const queryClient = useQueryClient();
  const playerShellRef = useRef<HTMLDivElement>(null);
  const artInstanceRef = useRef<Artplayer | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [lightOn, setLightOn] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("playerLightOn");
      return stored ? JSON.parse(stored) : true;
    } catch {
      return true;
    }
  });
  const [autoPlay, setAutoPlay] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("autoPlay");
      return stored ? JSON.parse(stored) : true;
    } catch {
      return true;
    }
  });
  const [nextIframePreloadUrl, setNextIframePreloadUrl] = useState<string>("");

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

  const previousEpisode = useMemo(() => {
    if (!sortedEpisodes.length) return null;
    const currentIdx = sortedEpisodes.findIndex(
      (episode) => episode.episodeId === selectedEpisode,
    );
    if (currentIdx <= 0) return null;
    return sortedEpisodes[currentIdx - 1] || null;
  }, [sortedEpisodes, selectedEpisode]);

  const goToEpisode = useCallback(
    (episodeId: string | undefined) => {
      if (!episodeId || !animeId) return;
      setSelectedEpisode(episodeId);
      router.push(`${ROUTES.WATCH}?anime=${animeId}&episode=${episodeId}`);
    },
    [animeId, router, setSelectedEpisode],
  );

  const selectedServerForPrefetch = playerData?.selected?.serverName || serverName || undefined;
  const selectedCategoryForPrefetch = playerData?.selected?.category || key || "sub";

  const prefetchEpisodePlayer = useCallback(
    async (episodeId: string | undefined) => {
      if (!episodeId) return;
      const queryKey = episodePlayerDataQueryKey(
        episodeId,
        selectedServerForPrefetch,
        selectedCategoryForPrefetch,
      );

      const data = await queryClient.fetchQuery({
        queryKey,
        queryFn: () =>
          getEpisodePlayerData(
            episodeId,
            selectedServerForPrefetch,
            selectedCategoryForPrefetch,
          ),
        staleTime: 1000 * 60 * 5,
      });

      setNextIframePreloadUrl(data?.source?.iframeUrl || "");
      const sourceUrl = data?.source?.sources?.[0]?.url;
      if (!sourceUrl) return;

      try {
        const referer = data.source.headers?.Referer || "https://megacloud.blog";
        const source = sourceUrl.includes("%") ? decodeURIComponent(sourceUrl) : sourceUrl;
        await fetch(
          `/api/m3u8?url=${encodeURIComponent(source)}&ref=${encodeURIComponent(referer)}`,
          { cache: "force-cache" },
        );
      } catch {
        // Source metadata is already prefetched; ignore manifest warmup failures.
      }
    },
    [queryClient, selectedCategoryForPrefetch, selectedServerForPrefetch],
  );

  useEffect(() => {
    if (!selectedEpisode || !sortedEpisodes.length) return;
    const currentIdx = sortedEpisodes.findIndex(
      (episode) => episode.episodeId === selectedEpisode,
    );
    if (currentIdx === -1) return;

    const nextEpisodes = sortedEpisodes.slice(currentIdx + 1, currentIdx + 4);
    const timeouts = nextEpisodes.map((episode, index) =>
      window.setTimeout(() => {
        void prefetchEpisodePlayer(episode.episodeId);
      }, index * 600),
    );

    return () => {
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
    };
  }, [prefetchEpisodePlayer, selectedEpisode, sortedEpisodes]);

  const toggleExpand = useCallback(async () => {
    const target = playerShellRef.current;
    if (!target) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await target.requestFullscreen();
      }
    } catch (error) {
      console.error("Failed to toggle player fullscreen:", error);
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsExpanded(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleLight = useCallback(() => {
    setLightOn((current) => {
      const next = !current;
      try {
        localStorage.setItem("playerLightOn", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const toggleAutoPlay = useCallback(() => {
    setAutoPlay((current) => {
      const next = !current;
      try {
        localStorage.setItem("autoPlay", JSON.stringify(next));
      } catch {
        // ignore
      }
      if (next) {
        void artInstanceRef.current?.play?.().catch(() => {
          // ignore browser autoplay blocks
        });
      } else {
        artInstanceRef.current?.pause?.();
      }
      return next;
    });
  }, []);

  const toggleAutoNext = useCallback(() => {
    setAutoNext((current) => {
      const next = !current;
      try {
        localStorage.setItem("autoNext", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const onHandleAutoSkipChange = useCallback(
    (value: boolean) => {
      setAutoSkip(value);
      if (!auth) {
        try {
          localStorage.setItem("autoSkip", JSON.stringify(value));
        } catch {
          // ignore
        }
        return;
      }
      setTimeout(() => {
        void (async () => {
          const { error } = await supabase.auth.updateUser({
            data: { autoSkip: value },
          });
          if (!error) {
            setAuth({ ...auth, autoSkip: value });
          } else {
            console.error("Failed updating autoSkip metadata", error);
          }
        })();
      }, 0);
    },
    [auth, setAuth],
  );

  const toggleAutoSkip = useCallback(() => {
    void onHandleAutoSkipChange(!autoSkip);
  }, [autoSkip, onHandleAutoSkipChange]);

  const addToList = useCallback(() => {
    window.dispatchEvent(new CustomEvent("kitsune-open-watchlist"));
  }, []);

  const copyWatchTogetherLink = useCallback(() => {
    if (typeof window === "undefined") return;
    void navigator.clipboard?.writeText(window.location.href).catch(() => {
      // ignore clipboard permission failures
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const unlockAutoplay = () => {
      try {
        window.sessionStorage.setItem("kitsune-autoplay-unlocked", "1");
      } catch {
        // ignore
      }
    };

    window.addEventListener("pointerdown", unlockAutoplay, { passive: true });
    window.addEventListener("keydown", unlockAutoplay);

    return () => {
      window.removeEventListener("pointerdown", unlockAutoplay);
      window.removeEventListener("keydown", unlockAutoplay);
    };
  }, []);

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

  const sources = episodeData?.sources ?? [];
  const rawSubServers = useMemo(() => serversData?.sub ?? [], [serversData?.sub]);
  const rawDubServers = useMemo(() => serversData?.dub ?? [], [serversData?.dub]);
  const animeSubCount = anime?.anime?.info?.stats?.episodes?.sub ?? 0;
  const animeDubCount = anime?.anime?.info?.stats?.episodes?.dub ?? 0;
  const hasSubVersion = animeSubCount > 0 || rawSubServers.length > 0;
  const hasDubVersion = animeDubCount > 0 || rawDubServers.length > 0;
  const subServers = useMemo(
    () => (hasSubVersion ? rawSubServers : []),
    [hasSubVersion, rawSubServers],
  );
  const dubServers = useMemo(
    () =>
      hasDubVersion
        ? (rawDubServers.length ? rawDubServers : rawSubServers).map((server) => ({
            ...server,
          }))
        : [],
    [hasDubVersion, rawDubServers, rawSubServers],
  );

  // Extract ?ep=... safely for fallback iframe
  const episodeIdRaw = serversData?.episodeId;
  const epParam =
    typeof episodeIdRaw === "string" && episodeIdRaw.includes("?ep=")
      ? episodeIdRaw.split("?ep=")[1]
      : undefined;
  const animePoster = anime?.anime?.info?.poster;

  useEffect(() => {
    if (hasDubVersion || hasSubVersion) {
      if (key === "dub" && !hasDubVersion && hasSubVersion) {
        changeServer(serverName || subServers[0]?.serverName || "hd-1", "sub");
      } else if (key === "sub" && !hasSubVersion && hasDubVersion) {
        changeServer(serverName || dubServers[0]?.serverName || "hd-1", "dub");
      }
    }
  }, [
    dubServers,
    hasDubVersion,
    hasSubVersion,
    key,
    serverName,
    subServers,
  ]);

  const playerControlBar = (
    <PlayerControlBar
      autoPlay={autoPlay}
      autoNext={autoNext}
      autoSkip={autoSkip}
      lightOn={lightOn}
      hasPrevious={Boolean(previousEpisode)}
      hasNext={Boolean(nextEpisode)}
      onToggleExpand={toggleExpand}
      onToggleLight={toggleLight}
      onToggleAutoPlay={toggleAutoPlay}
      onToggleAutoNext={toggleAutoNext}
      onToggleAutoSkip={toggleAutoSkip}
      onPrevious={() => goToEpisode(previousEpisode?.episodeId)}
      onNext={() => goToEpisode(nextEpisode?.episodeId)}
      onAddToList={addToList}
      onWatchTogether={copyWatchTogetherLink}
    />
  );
  const playerShellClass = `relative ${
    lightOn ? "" : "z-50 shadow-2xl shadow-black"
  } ${isExpanded ? "h-screen bg-black" : ""}`;
  const expandedPlayerClass = isExpanded
    ? "h-[calc(100vh-2.75rem)] max-h-none min-h-0 aspect-auto"
    : "";
  const nextIframePreloader = nextIframePreloadUrl ? (
    <iframe
      title="Preloading next episode"
      src={nextIframePreloadUrl}
      className="pointer-events-none absolute size-px opacity-0"
      tabIndex={-1}
      aria-hidden="true"
      referrerPolicy="no-referrer"
    />
  ) : null;

  // Normal loading skeleton
  if (isLoading || (!episodeData && !isEpisodeDataError)) {
    return (
      <>
        {!lightOn ? <div className="fixed inset-0 z-40 bg-black/85" /> : null}
        <div
          ref={playerShellRef}
          className={playerShellClass}
          data-expanded={isExpanded}
        >
          <BrandedPlayerFallback
            title="Loading player"
            poster={animePoster}
            className={expandedPlayerClass}
          />
          {playerControlBar}
          {nextIframePreloader}
        </div>
      </>
    );
  }

  if (!episodeData) {
    return (
      <Alert variant="destructive" className="text-red-400">
        <AlertTitle className="font-bold">Episode Unavailable</AlertTitle>
        <AlertDescription>
          We could not load this episode source right now. Try another
          Aniwatch server.
        </AlertDescription>
      </Alert>
    );
  }

  // If no sources, use fallback iframe
  if (episodeData.iframeUrl) {
    return (
      <div>
        {!lightOn ? <div className="fixed inset-0 z-40 bg-black/85" /> : null}
        <div
          ref={playerShellRef}
          className={playerShellClass}
          data-expanded={isExpanded}
        >
          <BrandedPlayerFallback
            title={`Backup video player for episode ${serversData?.episodeNo ?? ""}`}
            src={episodeData.iframeUrl}
            poster={animePoster}
            className={expandedPlayerClass}
          />
          {playerControlBar}
          {nextIframePreloader}
        </div>

        <div className="flex flex-row bg-[#0f172a] items-start justify-between w-full p-5">
          <div>
            {hasSubVersion && (
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
                    {getServerDisplayName(s.serverName)}
                  </Button>
                ))}
              </div>
            )}

            {hasDubVersion && (
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
                    {getServerDisplayName(s.serverName)}
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
        {!lightOn ? <div className="fixed inset-0 z-40 bg-black/85" /> : null}
        <div
          ref={playerShellRef}
          className={playerShellClass}
          data-expanded={isExpanded}
        >
          {epParam ? (
            <BrandedPlayerFallback
              title={`Video player for episode ${epParam}`}
              src={`https://megaplay.buzz/stream/s-2/${epParam}/${key === "dub" ? "dub" : "sub"}`}
              poster={animePoster}
              className={expandedPlayerClass}
            />
          ) : (
            <div
              className={`relative w-full h-auto aspect-video min-h-[20vh] sm:min-h-[30vh] md:min-h-[40vh] lg:min-h-[60vh] max-h-[500px] lg:max-h-[calc(100vh-150px)] bg-black overflow-hidden p-4 ${expandedPlayerClass}`}
            >
              <div className="flex h-full w-full items-center justify-center text-sm text-slate-200">
                Episode source is temporarily unavailable. Please try again later.
              </div>
            </div>
          )}
          {playerControlBar}
          {nextIframePreloader}
        </div>
      </>
    );
  }

  return (
    <div>
      {!lightOn ? <div className="fixed inset-0 z-40 bg-black/85" /> : null}
      <div
        ref={playerShellRef}
        className={playerShellClass}
        data-expanded={isExpanded}
      >
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
          autoPlay={autoPlay}
          getInstance={(art) => {
            artInstanceRef.current = art;
          }}
          onEnded={() => {
            if (!autoNext || !nextEpisode?.episodeId) return;
            goToEpisode(nextEpisode.episodeId);
          }}
          className={expandedPlayerClass}
        />
        {playerControlBar}
        {nextIframePreloader}
      </div>

      <div className="flex flex-row bg-[#0f172a] items-start justify-between w-full p-5">
        <div>
          {hasSubVersion && (
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
                  {getServerDisplayName(s.serverName)}
                </Button>
              ))}
            </div>
          )}

          {hasDubVersion && (
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
                  {getServerDisplayName(s.serverName)}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoPlayerSection;
