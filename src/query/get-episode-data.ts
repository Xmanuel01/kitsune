import { GET_EPISODE_DATA } from "@/constants/query-keys";
import { api } from "@/lib/api";
import { IEpisodeSource } from "@/types/episodes";
import { useQuery } from "@tanstack/react-query";

const getEpisodeData = async (
  episodeId: string,
  server: string | undefined,
  subOrDub: string,
  episodeNumber?: string,
) => {
  const res = await api.get("/api/episode/sources", {
    params: {
      animeEpisodeId: decodeURIComponent(episodeId),
      server: server,
      category: subOrDub,
      episodeNumber,
    },
  });
  return res.data.data as IEpisodeSource;
};

export const useGetEpisodeData = (
  episodeId: string,
  server: string | undefined,
  subOrDub: string = "sub",
  episodeNumber?: string,
) => {
  return useQuery({
    queryFn: () => getEpisodeData(episodeId, server, subOrDub, episodeNumber),
    queryKey: [GET_EPISODE_DATA, episodeId, server, subOrDub, episodeNumber],
    refetchOnWindowFocus: false,
    enabled: Boolean(episodeId) && Boolean(server),
  });
};
