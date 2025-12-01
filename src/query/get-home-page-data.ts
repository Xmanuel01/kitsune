import { GET_HOME_PAGE_DATA } from "@/constants/query-keys";
import { api } from "@/lib/api";
import { IAnimeData } from "@/types/anime";
import { useQuery } from "@tanstack/react-query";

const getHomePageData = async () => {
    const res = await api.get("/api/home");
    return res.data.data as IAnimeData;
};

export const useGetHomePageData = () => {
    return useQuery({
        queryFn: getHomePageData,
        queryKey: [GET_HOME_PAGE_DATA],
        refetchOnWindowFocus: false,
        staleTime: 1000 * 60 * 5, // 5 minutes
        gcTime: 1000 * 60 * 10, // 10 minutes
    });
};
