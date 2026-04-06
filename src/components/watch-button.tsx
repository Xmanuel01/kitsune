"use client";

import React from "react";
import { CirclePlay } from "lucide-react";
import { ROUTES } from "@/constants/routes";

import { usePathname } from "next/navigation";
import { ButtonLink } from "./common/button-link";
import { useHasAnimeWatched } from "@/hooks/use-is-anime-watched";

import { useGetLastEpisodeWatched } from "@/hooks/use-get-last-episode-watched";

const WatchButton = () => {
  const pathName = usePathname();
  const animeId = pathName.split("/")[2];

  const { hasWatchedAnime } = useHasAnimeWatched(animeId);
  const latestEpisodeWatched = useGetLastEpisodeWatched(animeId);

  return (
    <ButtonLink
      href={`${ROUTES.WATCH}?anime=${animeId}`}
      className="max-w-fit text-base"
      LeftIcon={CirclePlay}
    >
      {hasWatchedAnime ? "Watch Again" : "Start Watching"}
    </ButtonLink>
  );
};

export default WatchButton;
