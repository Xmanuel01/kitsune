"use client";

import React from "react";

import { cn } from "@/lib/utils";

import { ROUTES } from "@/constants/routes";
import { Episode } from "@/types/episodes";
import { useAnimeStore } from "@/store/anime-store";
import { useHasAnimeWatched } from "@/hooks/use-is-anime-watched";
import { Captions, Mic } from "lucide-react";
import Link from "next/link";
import { WatchHistory } from "@/hooks/use-get-bookmark";

type Props = {
  className?: string;
  episode: Episode;
  showCard?: boolean;
  animeId: string;
  variant?: "card" | "list";
  subOrDub?: { sub: number; dub: number };
  watchedEpisodes?: WatchHistory[] | null;
};

const EpisodeCard = ({
  showCard = false,
  variant = "card",
  ...props
}: Props) => {
  const { selectedEpisode } = useAnimeStore();
  const { hasWatchedEpisode, watchProgress } = useHasAnimeWatched(
    props.animeId,
    props.episode.episodeId,
    props.watchedEpisodes!,
  );
  const progressPercent =
    watchProgress >= 90 ? 100 : Math.max(0, Math.min(100, watchProgress));

  if (showCard && variant === "card") {
    return (
      <div
        className={cn([
          "rounded-xl overflow-hidden relative cursor-pointer ",

          "h-[8.625rem] min-w-[8.625rem] max-w-[10.625rem] md:h-[10.75rem] md:max-w-[12.5rem]",
          props.className,
        ])}
      >
        {/* <Image */}
        {/*   src={props.episode.} */}
        {/*   alt="image" */}
        {/*   height={100} */}
        {/*   width={100} */}
        {/*   className="w-full h-full object-cover" */}
        {/*   unoptimized */}
        {/* /> */}

        <div className="absolute inset-0 m-auto h-full w-full bg-gradient-to-t from-[#000000a9] to-transparent"></div>
        <div className="absolute bottom-0 flex flex-col gap-1 px-4 pb-3">
          <h5 className="line-clamp-1">{`${props.episode.number}. ${props.episode.title}`}</h5>
          {/* <p className="line-clamp-2">{props.episode.airDate}</p> */}
        </div>
      </div>
    );
  } else if (!showCard && variant === "card") {
    return (
      <Link
        href={`${ROUTES.WATCH}?anime=${props.animeId}&episode=${props.episode.episodeId}`}
      >
        <div
          className={cn([
            "h-[5.25rem] rounded-lg cursor-pointer w-full flex items-center justify-center bg-secondary md:text-base text-xs",

            hasWatchedEpisode && "bg-slate-900",
          ])}
        >
          {`Episode ${props.episode.number}`}
        </div>
      </Link>
    );
  } else {
    const isSelected = selectedEpisode === props.episode.episodeId;
    return (
      <Link
        href={`${ROUTES.WATCH}?anime=${props.animeId}&episode=${props.episode.episodeId}`}
      >
        <div
          className="flex gap-5 items-center w-full relative h-fit overflow-hidden rounded-md p-2"
          style={
            isSelected
              ? { backgroundColor: "#e9376b" }
              : {}
          }
        >
          {!isSelected && progressPercent > 0 && (
            <span
              className="absolute inset-y-0 left-0 bg-green-300/80"
              style={{ width: `${progressPercent}%` }}
            />
          )}
          {/* <figure className="h-[3.125rem] w-[4.375rem] rounded-md overflow-hidden"> */}
          {/*   <Image */}
          {/*     src={props.episode.image} */}
          {/*     alt={`Episode ${props.episode.number}`} */}
          {/*     height={100} */}
          {/*     width={150} */}
          {/*     unoptimized */}
          {/*     className="h-full w-full object-cover" */}
          {/*   /> */}
          {/* </figure> */}
          <h3 className="relative z-10">{`Episode ${props.episode.number}`}</h3>
          {props.subOrDub && props.episode.number <= props.subOrDub.sub && (
            <Captions className="relative z-10 text-gray-400" />
          )}
          {props.subOrDub && props.episode.number <= props.subOrDub.dub && (
            <Mic className="relative z-10 text-gray-400" />
          )}
        </div>
      </Link>
    );
  }
};

export default EpisodeCard;
