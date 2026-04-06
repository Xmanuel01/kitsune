import { GET_ANIME_DETAILS } from "@/constants/query-keys";
import { api } from "@/lib/api";
import { IAnimeDetails } from "@/types/anime-details";
import { useQuery } from "@tanstack/react-query";

export const animeDetailsQueryKey = (animeId: string) =>
  [GET_ANIME_DETAILS, animeId] as const;

export const getAnimeDetails = async (animeId: string) => {
  const res = await api.get("/api/anime/" + animeId);
  return res.data.data as IAnimeDetails;
};

export const useGetAnimeDetails = (animeId: string) => {
  return useQuery({
    queryFn: () => getAnimeDetails(animeId),
    queryKey: animeDetailsQueryKey(animeId),
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    enabled: Boolean(animeId),
  });
};
