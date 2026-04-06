import { api } from "@/lib/api";
import { GET_EPISODE_DATA } from "@/constants/query-keys";
import { IEpisodeServers, IEpisodeSource } from "@/types/episodes";
import { useQuery } from "@tanstack/react-query";

type EpisodePlayerData = {
  servers: IEpisodeServers;
  source: IEpisodeSource;
  selected: {
    category: "sub" | "dub" | "raw";
    serverName: string;
  };
  serversFromCache?: boolean;
  sourceFromCache?: boolean;
};

function sanitizeEpisodeId(raw?: string | null) {
  if (!raw) return null;
  let decoded = String(raw);
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // ignore and use raw
  }

  const match = decoded.match(/^([^?]+)(\?ep=(\d+))?/);
  if (!match) return decoded.split("?")[0];
  return match[1] + (match[3] ? `?ep=${match[3]}` : "");
}

async function getEpisodePlayerData(
  episodeId: string,
  server: string | undefined,
  subOrDub: string,
  episodeNumber?: string,
) {
  const cleanId = sanitizeEpisodeId(episodeId) || episodeId;
  const res = await api.get("/api/episode/player", {
    params: {
      animeEpisodeId: cleanId,
      server,
      category: subOrDub,
      episodeNumber,
    },
  });
  return res.data.data as EpisodePlayerData;
}

export function useGetEpisodePlayerData(
  episodeId: string,
  server: string | undefined,
  subOrDub: string = "sub",
  episodeNumber?: string,
) {
  return useQuery({
    queryFn: () => getEpisodePlayerData(episodeId, server, subOrDub, episodeNumber),
    queryKey: [GET_EPISODE_DATA, "player", episodeId, server, subOrDub, episodeNumber],
    enabled: Boolean(episodeId),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
}
