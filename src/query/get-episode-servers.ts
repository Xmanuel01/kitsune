import { GET_EPISODE_SERVERS } from "@/constants/query-keys";
import { api } from "@/lib/api";
import { IEpisodeServers } from "@/types/episodes";
import { useQuery } from "@tanstack/react-query";

function sanitizeEpisodeId(raw?: string | null) {
  if (!raw) return null;
  let decoded = String(raw);
  try {
    decoded = decodeURIComponent(raw);
  } catch (e) {
    // ignore and use raw
  }

  // Keep only the base id and an optional `?ep=123` (digits only)
  const m = decoded.match(/^([^?]+)(\?ep=(\d+))?/);
  if (!m) return decoded.split("?")[0];
  return m[1] + (m[3] ? `?ep=${m[3]}` : "");
}

const getEpisodeServers = async (episodeId: string) => {
  const cleanId = sanitizeEpisodeId(episodeId) || episodeId;
  const res = await api.get("/api/episode/servers", {
    params: {
      animeEpisodeId: cleanId,
    },
  });
  return res.data.data as IEpisodeServers;
};

export const useGetEpisodeServers = (episodeId: string) => {
  return useQuery({
    queryFn: () => getEpisodeServers(episodeId),
    queryKey: [GET_EPISODE_SERVERS, episodeId],
    refetchOnWindowFocus: false,
    enabled: Boolean(episodeId),
  });
};
