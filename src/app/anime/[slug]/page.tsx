import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import AnimeDetailsClient from "@/app/anime/[slug]/anime-details-client";
import {
  getCachedAnimeBanner,
  getCachedAnimeDetails,
  getCachedAnimeEpisodes,
} from "@/lib/anime-data";
import { createQueryClient } from "@/lib/query-client";
import { animeBannerQueryKey } from "@/query/get-banner-anime";
import { animeDetailsQueryKey } from "@/query/get-anime-details";
import { allEpisodesQueryKey } from "@/query/get-all-episodes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function AnimeDetailsPage({ params }: Props) {
  const { slug } = await params;
  const queryClient = createQueryClient();

  const anime = await getCachedAnimeDetails(slug);
  queryClient.setQueryData(animeDetailsQueryKey(slug), anime);

  if (anime?.anime?.info?.anilistId) {
    const banner = await getCachedAnimeBanner(anime.anime.info.anilistId);
    queryClient.setQueryData(
      animeBannerQueryKey(anime.anime.info.anilistId),
      banner,
    );
  }

  const episodes = await getCachedAnimeEpisodes(slug);
  queryClient.setQueryData(allEpisodesQueryKey(slug), episodes);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AnimeDetailsClient animeId={slug} />
    </HydrationBoundary>
  );
}
