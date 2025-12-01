"use client";

import ContinueWatching from "@/components/continue-watching";
import FeaturedCollection from "@/components/featured-collection";
import { useGetHomePageData } from "@/query/get-home-page-data";
import { IAnime, IAnimeData, LatestCompletedAnime, SpotlightAnime } from "@/types/anime";
import dynamic from "next/dynamic";

// Dynamically import components
const HeroSection = dynamic(() => import("@/components/hero-section"));
const LatestEpisodesAnime = dynamic(
  () => import("@/components/latest-episodes-section"),
);
const AnimeSchedule = dynamic(() => import("@/components/anime-schedule"));
const AnimeSections = dynamic(() => import("@/components/anime-sections"));

export default function Home() {
  const { data, isLoading } = useGetHomePageData();

  return (
    <div className="flex flex-col bg-[#121212]">
      <HeroSection
        spotlightAnime={(data as IAnimeData)?.spotlightAnimes}
        isDataLoading={isLoading}
      />
      <LatestEpisodesAnime
        loading={isLoading}
        latestEpisodes={(data as IAnimeData)?.latestEpisodeAnimes}
      />

      <ContinueWatching loading={isLoading} />

      <FeaturedCollection
        loading={isLoading}
        featuredAnime={[
          {
            title: "Most Favorite Anime",
            anime: (data as IAnimeData)?.mostFavoriteAnimes,
          },
          {
            title: "Most Popular Anime",
            anime: (data as IAnimeData)?.mostPopularAnimes,
          },
          {
            title: "Latest Completed Anime",
            anime: (data as IAnimeData)?.latestCompletedAnimes,
          },
        ]}
      />
      <AnimeSections
        title={"Trending Anime"}
        trendingAnime={(data as IAnimeData)?.trendingAnimes}
        loading={isLoading}
      />

      <AnimeSchedule />

      <AnimeSections
        title={"Upcoming Animes"}
        trendingAnime={(data as IAnimeData)?.topUpcomingAnimes as IAnime[]}
        loading={isLoading}
      />
    </div>
  );
}
