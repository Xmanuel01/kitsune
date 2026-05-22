import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import HomePageClient from "@/app/home-page-client";
import { getCachedHomePageData } from "@/lib/anime-data";
import { createQueryClient } from "@/lib/query-client";
import { homePageQueryKey } from "@/query/get-home-page-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Home() {
  const queryClient = createQueryClient();
  const data = await getCachedHomePageData();

  queryClient.setQueryData(homePageQueryKey, data);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <HomePageClient />
    </HydrationBoundary>
  );
}
