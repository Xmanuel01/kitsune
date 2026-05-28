import { GET_ALL_EPISODES } from "@/constants/query-keys";
import { api } from "@/lib/api";
import { IEpisodes } from "@/types/episodes";
import { useQuery } from "@tanstack/react-query";

export const allEpisodesQueryKey = (animeId: string) =>
  [GET_ALL_EPISODES, animeId] as const;

export const getAllEpisodes = async (animeId: string) => {
  const res = await api.get(`/api/anime-episodes/${animeId}`);
  return res.data.data as IEpisodes;
};

export const useGetAllEpisodes = (animeId?: string) => {
  return useQuery({
    queryFn: () => getAllEpisodes(animeId as string),
    queryKey: allEpisodesQueryKey(animeId as string),
    enabled: Boolean(animeId),
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });
};
