"use client";

import React, {
  useEffect,
  useRef,
  useMemo,
  useState,
  HTMLAttributes,
} from "react";
import Artplayer from "artplayer";
type Option = any;

import Hls from "hls.js";

import { IEpisodeServers, IEpisodeSource, IEpisodes } from "@/types/episodes";
import loadingImage from "@/assets/genkai.gif";
import styles from "./player.module.css";
import artplayerPluginHlsControl from "artplayer-plugin-hls-control";
import artplayerPluginAmbilight from "artplayer-plugin-ambilight";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth-store";
import useBookMarks from "@/hooks/use-get-bookmark";
import { supabase } from "@/lib/supabaseClient";
import Image from "next/image";

const WATCH_PROGRESS_UPDATE_INTERVAL = 10000; // Update every 10 seconds
const WATCH_PROGRESS_MIN_WATCH_TIME = 10; // Min seconds watched to create record

// All proxying now goes through Vercel API route
const proxyBaseURI = "/api/m3u8";

// --- Define Props for the Combined Player ---
interface ArtPlayerProps extends HTMLAttributes<HTMLDivElement> {
  episodeInfo: IEpisodeSource;
  animeInfo: { title: string; image: string; id: string };
  subOrDub: "sub" | "dub";
  episodes?: IEpisodes;
  getInstance?: (art: Artplayer) => void;
  autoSkip?: boolean;
  serversData: IEpisodeServers;
}

// --- Helper to generate highlights ---
interface HighlightPoint {
  time: number;
  text: string;
}
const generateHighlights = (
  start: number | undefined | null,
  end: number | undefined | null,
  label: string,
): HighlightPoint[] => {
  if (start == null || end == null || start >= end) return [];
  const highlights: HighlightPoint[] = [];
  for (let time = Math.floor(start); time <= Math.floor(end); time++) {
    highlights.push({ time, text: label });
  }
  return highlights;
};

function KitsunePlayer({
  episodeInfo,
  animeInfo,
  subOrDub,
  getInstance,
  autoSkip = true,
  serversData,
  episodes,
  ...rest
}: ArtPlayerProps): JSX.Element {
  const artContainerRef = useRef<HTMLDivElement>(null);
  const artInstanceRef = useRef<Artplayer | null>(null);
  const hlsInstanceRef = useRef<Hls | null>(null);

  const [isAutoSkipEnabled, setIsAutoSkipEnabled] = useState(autoSkip);

  const bookmarkIdRef = useRef<string | null>(null);
  const watchHistoryIdsRef = useRef<string[]>([]);
  const watchedRecordIdRef = useRef<string | null>(null);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastUpdateTimeRef = useRef<number>(0);
  const hasMetMinWatchTimeRef = useRef<boolean>(false);
  const initialSeekTimeRef = useRef<number | null>(0); // Initialize to 0 to start from beginning

  const { auth } = useAuthStore();
  const { createOrUpdateBookMark, syncWatchProgress } = useBookMarks({
    populate: false,
  });

  useEffect(() => {
    setIsAutoSkipEnabled(autoSkip);
  }, [autoSkip]);

  // Prewarm next episodes
  useEffect(() => {
    if (!episodes) return;
    if (!serversData?.episodeId) return;

    const epsArray = (episodes as any).episodes ?? [];
    if (!Array.isArray(epsArray) || epsArray.length === 0) return;

    const currentEpisodeId = serversData.episodeId;

    const idx = epsArray.findIndex(
      (ep: any) =>
        ep.id === currentEpisodeId ||
        ep.episodeId === currentEpisodeId ||
        ep.slug === currentEpisodeId,
    );

    if (idx === -1) return;

    const nextEpisodes: string[] = epsArray
      .slice(idx + 1, idx + 1 + 5)
      .map((ep: any) => ep.id ?? ep.episodeId ?? ep.slug)
      .filter(Boolean);

    if (nextEpisodes.length === 0) return;

    fetch("/api/episode/prewarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        episodeIds: nextEpisodes,
        category: subOrDub ?? "sub",
      }),
    }).catch((err) => console.error("prewarm error:", err));
  }, [episodes, serversData?.episodeId, subOrDub]);

  // --- Construct proxied video URI using Vercel API route ---
  const uri = useMemo(() => {
    const firstSourceUrl = episodeInfo?.sources?.[0]?.url;
    const referer = episodeInfo?.headers?.Referer || 'https://megacloud.blog';
    if (!firstSourceUrl) return null;

    try {
      const url = encodeURIComponent(firstSourceUrl);
      const refParam = `&ref=${encodeURIComponent(referer)}`;
      return `${proxyBaseURI}?url=${url}${refParam}`;
    } catch (error) {
      console.error("Error constructing proxy URI:", error);
      return null;
    }
  }, [episodeInfo]);

  // Custom loader for HLS.js to ensure all requests go through our proxy
  const customLoader = useMemo(() => {
    return class CustomLoader extends Hls.DefaultConfig.loader {
      load(context: any, config: any, callbacks: any) {
        if (context.url && !context.url.startsWith(proxyBaseURI)) {
          const referer = episodeInfo?.headers?.Referer || 'https://megacloud.blog';
          const proxyUrl = `${proxyBaseURI}?url=${encodeURIComponent(context.url)}&ref=${encodeURIComponent(referer)}`;
          context.url = proxyUrl;
        }
        return super.load(context, config, callbacks);
      }
    };
  }, [episodeInfo?.headers?.Referer]);

  const skipTimesRef = useRef<{
    introStart?: number;
    introEnd?: number;
    validIntro: boolean;
    outroStart?: number;
    outroEnd?: number;
    validOutro: boolean;
  }>({ validIntro: false, validOutro: false });

  // Bookmark + watch history loading
  useEffect(() => {
    if (!auth || !animeInfo.id || !serversData.episodeId) {
      bookmarkIdRef.current = null;
      watchedRecordIdRef.current = null;
      watchHistoryIdsRef.current = [];
      hasMetMinWatchTimeRef.current = false;
      initialSeekTimeRef.current = null;
      return;
    }

    let isMounted = true;

    const fetchBookmarkAndWatchedId = async () => {
      const id = await createOrUpdateBookMark(
        animeInfo.id,
        animeInfo.title,
        animeInfo.image,
        "watching",
        false,
      );

      if (!isMounted || !id) {
        bookmarkIdRef.current = null;
        watchedRecordIdRef.current = null;
        watchHistoryIdsRef.current = [];
        initialSeekTimeRef.current = null;
        hasMetMinWatchTimeRef.current = false;
        return;
      }

      bookmarkIdRef.current = id;
      hasMetMinWatchTimeRef.current = false;

      try {
        const { data: expandedBookmark, error: bookmarkError } = await supabase
          .from("bookmarks")
          .select("*")
          .eq("id", id)
          .maybeSingle();

        if (bookmarkError) throw bookmarkError;
        if (!isMounted) return;

        let history: any[] = [];
        if (expandedBookmark) {
          if (
            Array.isArray(expandedBookmark.watchHistory) &&
            expandedBookmark.watchHistory.length
          ) {
            const ids = expandedBookmark.watchHistory;
            const { data: watchedRows } = await supabase
              .from("watched")
              .select("*")
              .in("id", ids);
            history = watchedRows || [];
          } else if (
            expandedBookmark.expand &&
            Array.isArray((expandedBookmark.expand as any).watchHistory)
          ) {
            history = (expandedBookmark.expand as any).watchHistory;
          }
        }

        const existingWatched = history.find(
          (watched: any) => watched.episodeId === serversData.episodeId,
        );

        if (existingWatched) {
          watchedRecordIdRef.current = existingWatched.id;
          initialSeekTimeRef.current =
            typeof existingWatched.current === "number"
              ? existingWatched.current
              : null;
          hasMetMinWatchTimeRef.current =
            initialSeekTimeRef.current !== null &&
            initialSeekTimeRef.current >= WATCH_PROGRESS_MIN_WATCH_TIME;
        } else {
          watchedRecordIdRef.current = null;
          initialSeekTimeRef.current = null;
          hasMetMinWatchTimeRef.current = false;
        }
      } catch (e) {
        console.error("Error fetching bookmark watch history:", e);
        if (!isMounted) return;
        watchedRecordIdRef.current = null;
        initialSeekTimeRef.current = null;
        hasMetMinWatchTimeRef.current = false;
      }
    };

    fetchBookmarkAndWatchedId();

    return () => {
      isMounted = false;
    };
  }, [
    auth,
    animeInfo.id,
    animeInfo.title,
    animeInfo.image,
    serversData.episodeId,
    createOrUpdateBookMark,
  ]);

  // --- Player Init + Cleanup ---
  useEffect(() => {
    if (!artContainerRef.current || !uri) {
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy();
        hlsInstanceRef.current = null;
      }
      if (artInstanceRef.current) {
        artInstanceRef.current.destroy(true);
        artInstanceRef.current = null;
      }
      return;
    }
    
    // Reset initial seek time to 0 when changing episodes
    initialSeekTimeRef.current = 0;

    const introStart = episodeInfo?.intro?.start;
    const introEnd = episodeInfo?.intro?.end;
    skipTimesRef.current.validIntro =
      typeof introStart === "number" &&
      typeof introEnd === "number" &&
      introStart < introEnd;
    skipTimesRef.current.introStart = introStart;
    skipTimesRef.current.introEnd = introEnd;

    const outroStart = episodeInfo?.outro?.start;
    const outroEnd = episodeInfo?.outro?.end;
    skipTimesRef.current.validOutro =
      typeof outroStart === "number" &&
      typeof outroEnd === "number" &&
      outroStart < outroEnd;
    skipTimesRef.current.outroStart = outroStart;
    skipTimesRef.current.outroEnd = outroEnd;

    const refererValue = episodeInfo?.headers?.Referer;
    const refParam = refererValue
      ? `&ref=${encodeURIComponent(refererValue)}`
      : "";

    // Note: here we store raw track.url and build proxied URL when switching
    const trackOptions: any = (episodeInfo?.tracks ?? []).map((track) => ({
      default: track.lang === "English",
      html: track.lang,
      url: track.url as string,
    }));

    const defaultTrack = episodeInfo?.tracks?.find(
      (track) => track.lang === "English",
    )?.url;

    const subtitleConfig: Option["subtitle"] =
      subOrDub === "sub"
        ? {
            url: defaultTrack
              ? `${proxyBaseURI}?url=${encodeURIComponent(
                  defaultTrack,
                )}${refParam}`
              : "",
            type: "vtt",
            style: {
              color: "#FFFFFF",
              fontSize: "22px",
              textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
            },
            encoding: "utf-8",
            escape: false,
          }
        : {};

    const manualSkipControl = {
      name: "manual-skip",
      position: "right",
      html: `
        <div style="display: flex; align-items: center; gap: 4px; padding: 0 6px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
               viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <polygon points="5 4 15 12 5 20 5 4"/>
               <line x1="19" x2="19" y1="5" y2="19"/>
          </svg>
          <span class="art-skip-text">Skip</span>
        </div>
      `,
      tooltip: "Skip",
      style: {
        display: "none",
        cursor: "pointer",
        borderRadius: "4px",
        marginRight: "10px",
        padding: "3px 0",
      },
      click: function (controlItem: any) {
        const art = artInstanceRef.current;
        if (!art) return;
        const { introEnd, outroStart, outroEnd, validIntro, validOutro } =
          skipTimesRef.current;
        const currentTime = art.currentTime;
        const duration = art.duration;

        let seekTarget: number | null = null;
        const resolvedOutroEnd =
          validOutro && outroEnd === 0 && duration > 0 ? duration : outroEnd;

        if (
          validIntro &&
          typeof introEnd === "number" &&
          currentTime >= skipTimesRef.current.introStart! &&
          currentTime < introEnd
        ) {
          seekTarget = introEnd;
        } else if (
          validOutro &&
          typeof outroStart === "number" &&
          typeof resolvedOutroEnd === "number" &&
          currentTime >= outroStart &&
          currentTime < resolvedOutroEnd
        ) {
          seekTarget =
            resolvedOutroEnd === duration ? duration - 0.1 : resolvedOutroEnd;
        }

        if (typeof seekTarget === "number") {
          art.seek = Math.min(seekTarget, duration);
        }

        if (controlItem.style) controlItem.style.display = "none";
      },
    };

    let currentHlsInstanceForCleanup: Hls | null = null;

    const finalOptions: Option = {
      container: artContainerRef.current,
      url: uri,
      type: "m3u8",
      customType: {
        m3u8: (
          videoElement: HTMLMediaElement,
          url: string,
          artPlayerInstance: Artplayer,
        ) => {
          if (Hls.isSupported()) {
            if (hlsInstanceRef.current) {
              try {
                hlsInstanceRef.current.destroy();
              } catch {
                // ignore
              }
              hlsInstanceRef.current = null;
            }

            const hls = new Hls({ loader: customLoader });
            hls.loadSource(url);
            hls.attachMedia(videoElement);

            hlsInstanceRef.current = hls;
            currentHlsInstanceForCleanup = hls;

            (artPlayerInstance as any).hls = hls;

            artPlayerInstance.on("destroy", () => {
              try {
                hls.destroy();
              } catch {
                // ignore
              }
              if (hlsInstanceRef.current === hls) {
                hlsInstanceRef.current = null;
              }
              (artPlayerInstance as any).hls = null;
              currentHlsInstanceForCleanup = null;
              console.log("HLS instance destroyed via ArtPlayer destroy event.");
            });
          } else if (
            videoElement.canPlayType("application/vnd.apple.mpegurl")
          ) {
            videoElement.src = url;
          } else {
            artPlayerInstance.notice.show =
              "HLS playback is not supported on your browser.";
          }
        },
      },
      plugins: [
        artplayerPluginHlsControl({
          quality: {
            control: true,
            setting: true,
            getName: (level: { height?: number; bitrate?: number }) =>
              level.height ? `${level.height}P` : "Auto",
            title: "Quality",
            auto: "Auto",
          },
          audio: {
            control: true,
            setting: true,
            getName: (track: { name?: string }) => track.name ?? "Unknown",
            title: "Audio",
            auto: "Auto",
          },
        }),
        artplayerPluginAmbilight({
          blur: "30",
          opacity: 0.8,
          frequency: 10,
          duration: 0.3,
          zIndex: -1,
        }),
      ],
      settings: [
        {
          width: 250,
          html: "Subtitle",
          tooltip: "Subtitle",
          selector: [
            {
              html: "Display",
              tooltip: subOrDub === "sub" ? "Hide" : "Show",
              switch: subOrDub === "sub",
              onSwitch: function (item: any) {
                const showSubtitle = !item.switch;
                art.subtitle.show = showSubtitle;
                item.tooltip = showSubtitle ? "Hide" : "Show";
                console.log(`Subtitle display set to: ${showSubtitle}`);
                return showSubtitle;
              },
            },
            ...trackOptions,
          ],
          onSelect: function (item: any) {
            if (item.url && typeof item.url === "string") {
              const proxiedTrackUrl = `${proxyBaseURI}?url=${encodeURIComponent(
                item.url,
              )}${refParam}`;
              art.subtitle.switch(proxiedTrackUrl, {
                name: item.html,
              });
              return item.html ?? "Subtitle";
            }
            return item.html ?? "Subtitle";
          },
        },
      ],
      controls: [manualSkipControl],
      highlight: [
        ...generateHighlights(
          episodeInfo?.intro?.start,
          episodeInfo?.intro?.end,
          "Intro",
        ),
        ...generateHighlights(
          episodeInfo?.outro?.start,
          episodeInfo?.outro?.end,
          "Outro",
        ),
      ],
      poster: animeInfo.image,
      volume: 0.8,
      isLive: false,
      muted: false,
      autoplay: false,
      autoOrientation: true,
      pip: true,
      autoSize: false,
      autoMini: false,
      screenshot: true,
      setting: true,
      loop: false,
      flip: false,
      playbackRate: true,
      aspectRatio: true,
      fullscreen: true,
      fullscreenWeb: true,
      subtitleOffset: true,
      miniProgressBar: false,
      mutex: true,
      backdrop: true,
      playsInline: true,
      autoPlayback: true,
      airplay: true,
      theme: "#F5316F",
      moreVideoAttr: { crossOrigin: "anonymous" },
      subtitle: subtitleConfig,
      icons: {
        loading: `<img width="60" height="60" src="${loadingImage.src}">`,
      },
    };

    console.log(finalOptions);
    const art = new Artplayer(finalOptions);
    artInstanceRef.current = art;

    const handleTimeUpdate = () => {
      const art = artInstanceRef.current;
      if (!art || art.loading.show) return;

      const currentTime = art.currentTime;
      const duration = art.duration;
      const {
        introStart,
        introEnd,
        validIntro,
        outroStart,
        outroEnd,
        validOutro,
      } = skipTimesRef.current;

      const resolvedOutroEnd =
        validOutro && outroEnd === 0 && duration > 0 ? duration : outroEnd;
      const inIntro =
        validIntro &&
        typeof introStart === "number" &&
        typeof introEnd === "number" &&
        currentTime >= introStart &&
        currentTime < introEnd;
      const inOutro =
        validOutro &&
        typeof outroStart === "number" &&
        typeof resolvedOutroEnd === "number" &&
        currentTime >= outroStart &&
        currentTime < resolvedOutroEnd;

      const manualSkip: any = (art as any).controls["manual-skip"];

      if (isAutoSkipEnabled) {
        if (manualSkip?.style?.display !== "none") {
          if (manualSkip.style) manualSkip.style.display = "none";
        }
        if (inIntro && typeof introEnd === "number") {
          art.seek = introEnd;
        } else if (inOutro && typeof resolvedOutroEnd === "number") {
          const seekTarget =
            resolvedOutroEnd === duration ? duration - 0.1 : resolvedOutroEnd;
          art.seek = Math.min(seekTarget, duration);
        }
      } else {
        if (!manualSkip) return;

        if (inIntro || inOutro) {
          if (manualSkip.style?.display === "none") {
            if (manualSkip.style) manualSkip.style.display = "inline-flex";
          }
          const skipText = inIntro ? "Intro" : "Outro";
          const textElement = manualSkip.querySelector(".art-skip-text");
          if (textElement && textElement.textContent !== `Skip ${skipText}`) {
            textElement.textContent = `Skip ${skipText}`;
          }
        } else {
          if (manualSkip.style?.display !== "none") {
            if (manualSkip.style) manualSkip.style.display = "none";
          }
        }
      }

      // Watch progress
      if (
        !hasMetMinWatchTimeRef.current &&
        currentTime >= WATCH_PROGRESS_MIN_WATCH_TIME
      ) {
        console.log("Minimum watch time met.");
        hasMetMinWatchTimeRef.current = true;
        if (!watchedRecordIdRef.current) {
          console.log("Triggering initial sync after min watch time.");
          syncWatchProgress(bookmarkIdRef.current, null, {
            episodeId: serversData.episodeId,
            episodeNumber: parseInt(serversData.episodeNo),
            current: currentTime,
            duration: duration,
          }).then((newId) => {
            if (newId) {
              watchedRecordIdRef.current = newId;
              watchHistoryIdsRef.current.push(newId);
            }
          });
          lastUpdateTimeRef.current = Date.now();
        }
      }

      if (
        (hasMetMinWatchTimeRef.current || watchedRecordIdRef.current) &&
        Date.now() - lastUpdateTimeRef.current > WATCH_PROGRESS_UPDATE_INTERVAL
      ) {
        syncWatchProgress(
          bookmarkIdRef.current,
          watchedRecordIdRef.current,
          {
            episodeId: serversData.episodeId,
            episodeNumber: parseInt(serversData.episodeNo),
            current: currentTime,
            duration: duration,
          },
        ).then((id) => {
          if (id) watchedRecordIdRef.current = id;
        });
        lastUpdateTimeRef.current = Date.now();
      }
    };

    art.on("ready", () => {
      console.log("ArtPlayer ready. Duration:", art.duration);
      art.subtitle.style({
        fontSize: art.height * 0.04 + "px",
      });

      // Always start from beginning - disable auto-resume
      console.log("Player ready, starting from beginning.");
      initialSeekTimeRef.current = null;
      art.seek = 0;
    });

    art.on("resize", () => {
      if (!artInstanceRef.current) return;
      const newSize = Math.max(
        14,
        Math.min(32, artInstanceRef.current.height * 0.04),
      );
      artInstanceRef.current.subtitle.style({ fontSize: `${newSize}px` });
    });

    art.on("error", (error, reconnectTime) => {
      console.error(
        "ArtPlayer Error:",
        error,
        "Reconnect attempt:",
        reconnectTime,
      );
      if (artInstanceRef.current) {
        (artInstanceRef.current as any).notice.show = `Error: ${
          (error as any).message || "Playback failed"
        }`;
      }
    });

    art.on("video:timeupdate", handleTimeUpdate);

    const handleInteractionUpdate = () => {
      const art = artInstanceRef.current;
      if (!art || !art.duration || art.duration <= 0) return;
      if (hasMetMinWatchTimeRef.current || watchedRecordIdRef.current) {
        console.log("Syncing progress on pause/seek.");
        if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
        syncWatchProgress(
          bookmarkIdRef.current,
          watchedRecordIdRef.current,
          {
            episodeId: serversData.episodeId,
            episodeNumber: parseInt(serversData.episodeNo),
            current: art.currentTime,
            duration: art.duration,
          },
        ).then((id) => {
          if (id) watchedRecordIdRef.current = id;
        });
        lastUpdateTimeRef.current = Date.now();
      }
    };

    art.on("video:pause", handleInteractionUpdate);
    art.on("video:seeked", handleInteractionUpdate);

    if (getInstance && typeof getInstance === "function") {
      getInstance(art);
    }

    // Cleanup
    return () => {
      console.log(
        "Running cleanup for ArtPlayer instance:",
        artInstanceRef.current?.id,
      );

      const art = artInstanceRef.current;
      const hls = hlsInstanceRef.current;

      if (hls) {
        console.log("Cleanup: Detaching HLS media");
        if (hls.media) {
          hls.detachMedia();
        }
        console.log("Cleanup: Destroying HLS instance.");
        try {
          hls.destroy();
        } catch {
          // ignore
        }
        hlsInstanceRef.current = null;
      }

      if (
        art &&
        art.duration > 0 &&
        (hasMetMinWatchTimeRef.current || watchedRecordIdRef.current)
      ) {
        console.log("Syncing final progress on unmount.");
        syncWatchProgress(
          bookmarkIdRef.current,
          watchedRecordIdRef.current,
          {
            episodeId: serversData.episodeId,
            episodeNumber: parseInt(serversData.episodeNo),
            current: art.currentTime,
            duration: art.duration,
          },
        );
      }

      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
        updateTimerRef.current = null;
      }

      if (art) {
        console.log("Cleanup: Destroying ArtPlayer instance.");
        art.off("video:pause", handleInteractionUpdate);
        art.off("video:seeked", handleInteractionUpdate);
        art.off("video:timeupdate", handleTimeUpdate);

        console.log("Cleanup: Pausing player");
        art.pause();

        if (art.video) {
          console.log("Cleanup: Removing video src and loading");
          art.video.removeAttribute("src");
          art.video.load();
        }

        if (currentHlsInstanceForCleanup) {
          console.log(
            "Cleanup: Destroying HLS instance specifically for ArtPlayer:",
            art.id,
          );
          try {
            currentHlsInstanceForCleanup.destroy();
          } catch {
            // ignore
          }
          if (hlsInstanceRef.current === currentHlsInstanceForCleanup) {
            hlsInstanceRef.current = null;
          }
          currentHlsInstanceForCleanup = null;
        } else if (hlsInstanceRef.current) {
          console.warn(
            "Cleanup: currentHlsInstanceForCleanup was null, attempting to destroy hlsInstanceRef.current for ArtPlayer:",
            art.id,
          );
          try {
            hlsInstanceRef.current.destroy();
          } catch {
            // ignore
          }
          hlsInstanceRef.current = null;
        }

        (art as any).hls = null;

        art.destroy(true);
        if (artInstanceRef.current === art) {
          artInstanceRef.current = null;
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, episodeInfo, animeInfo, subOrDub, getInstance, autoSkip]);

  // --- Render ---
  return (
    <div
      className={cn(
        "relative w-full h-auto aspect-video  min-h-[20vh] sm:min-h-[30vh] md:min-h-[40vh] lg:min-h-[60vh] max-h-[500px] lg:max-h-[calc(100vh-150px)] bg-black overflow-hidden",
        rest.className ?? "",
      )}
    >
      <div ref={artContainerRef} className="w-full h-full">
        {!uri && (
          <div
            className={styles.loadingBackground}
            style={{ ['--bg-image' as any]: `url(${animeInfo.image})` }}
          >
            <Image
              src={loadingImage.src}
              alt="Loading..."
              className={styles.loadingImage}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default KitsunePlayer;
