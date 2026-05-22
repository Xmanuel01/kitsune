import { GET_ANIME_BANNER } from "@/constants/query-keys";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

interface IAnimeBanner {
  Media: {
    id: number;
    bannerImage: string;
  };
}

export const animeBannerQueryKey = (anilistID: number) =>
  [GET_ANIME_BANNER, anilistID] as const;

export const getAnimeBanner = async (anilistID: number) => {
  const res = await api.post("https://graphql.anilist.co", {
    query: `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          bannerImage
        }
      }
    `,
    variables: {
      id: anilistID,
    },
  });
  return res.data.data as IAnimeBanner;
};

export const useGetAnimeBanner = (anilistID: number) => {
  return useQuery({
    queryFn: () => getAnimeBanner(anilistID),
    queryKey: animeBannerQueryKey(anilistID),
    enabled: !!anilistID,
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
  });
};
