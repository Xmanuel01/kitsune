import { supabase } from "@/lib/supabaseClient";
import { useAuthStore } from "@/store/auth-store";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Props = {
  animeID?: string;
  status?: string;
  page?: number;
  per_page?: number;
  populate?: boolean;
};

export type Bookmark = {
  id: string;
  user: string;
  animeId: string;
  thumbnail: string;
  animeTitle: string;
  status: string;
  created: string;
  expand: {
    watchHistory: WatchHistory[];
  };
};

export type WatchHistory = {
  id: string;
  current: number;
  timestamp: number;
  episodeId: string;
  episodeNumber: number;
  created: string;
};

function useBookMarks({
  animeID,
  status,
  page,
  per_page,
  populate = true,
}: Props) {
  const { auth } = useAuthStore();
  const [bookmarks, setBookmarks] = useState<Bookmark[] | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  const filterParts = [];

  if (animeID) {
    filterParts.push(`animeId='${animeID}'`);
  }

  if (status) {
    filterParts.push(`status='${status}'`);
  }

  const filters = filterParts.join(" && ");

  useEffect(() => {
    if (!populate) return;
    const getBookmarks = async () => {
      try {
        setIsLoading(true);
        const from = ((page || 1) - 1) * (per_page || 20);
        const to = (page || 1) * (per_page || 20) - 1;
        let q = supabase.from('bookmarks').select('*', { count: 'exact' }).range(from, to).order('updated', { ascending: false });
        if (filters) {
          // very small parser for simple filters like animeId='...'
          const m = filters.match(/^(\w+)=['"]([^'"]+)['"]$/);
          if (m) q = (q as any).eq(m[1], m[2]);
        }

        const res = await q;
        // @ts-ignore
        const items = res.data ?? [];
        // @ts-ignore
        const count = typeof res.count === 'number' ? res.count : items.length;
        const totalPages = Math.ceil(count / (per_page || 20)) || 0;

        if (items.length > 0) {
          // If expand requested, fetch watchHistory records per bookmark
          if (populate) {
            // find bookmarks that have a watchHistory array of ids
            const bookmarksWithHistory = items.filter((b: any) => Array.isArray(b.watchHistory) && b.watchHistory.length);
            if (bookmarksWithHistory.length) {
              const allIds = Array.from(new Set(bookmarksWithHistory.flatMap((b: any) => b.watchHistory)));
              const { data: watchedData } = await supabase.from('watched').select('*').in('id', allIds);
              const watchedById: Record<string, any> = {};
              (watchedData || []).forEach((w: any) => (watchedById[w.id] = w));
              // attach expand.watchHistory
              items.forEach((b: any) => {
                b.expand = b.expand || {};
                const ids = Array.isArray(b.watchHistory) ? b.watchHistory : [];
                b.expand.watchHistory = ids.map((id: string) => watchedById[id]).filter(Boolean);
              });
            }
          }

          setTotalPages(totalPages);
          setBookmarks(items);
        } else {
          setBookmarks(null);
        }
        setIsLoading(false);
      } catch (error) {
        setIsLoading(false);
        console.log(error);
      }
    };

    getBookmarks();
  }, [animeID, status, page, per_page, filters, auth, populate]);

  const createOrUpdateBookMark = async (
    animeID: string,
    animeTitle: string,
    animeThumbnail: string,
    status: string,
    showToast: boolean = true,
  ): Promise<string | null> => {
    if (!auth) {
      return null;
    }
    try {
      // Check if bookmark exists
      const { data: existingRes } = await supabase.from('bookmarks').select('*').eq('animeId', animeID).limit(1).maybeSingle();
      if (existingRes) {
        if (existingRes.status === status) {
          if (showToast) toast.error('Already in this status', { style: { background: 'red' } });
          return existingRes.id;
        }
        const { data: updated } = await supabase.from('bookmarks').update({ status }).eq('id', existingRes.id).select().maybeSingle();
        if (showToast) toast.success('Successfully updated status', { style: { background: 'green' } });
        return updated?.id ?? null;
      } else {
        const { data: created } = await supabase.from('bookmarks').insert({ user: auth.id, animeId: animeID, animeTitle, thumbnail: animeThumbnail, status }).select().maybeSingle();
        if (showToast) toast.success('Successfully added to list', { style: { background: 'green' } });
        return created?.id ?? null;
      }
    } catch (error) {
      console.log(error);
      return null;
    }
  };

  const syncWatchProgress = async (
    bookmarkId: string | null,
    watchedRecordId: string | null,
    episodeData: {
      episodeId: string;
      episodeNumber: number;
      current: number;
      duration: number;
    },
  ): Promise<string | null> => {
    if (!auth || !bookmarkId) return watchedRecordId;

    const dataToSave = {
      episodeId: episodeData.episodeId,
      episodeNumber: episodeData.episodeNumber,
      current: Math.round(episodeData.current), // Store as integer seconds
      timestamp: Math.round(episodeData.duration), // Use 'timestamp' field for duration
    };

    try {
      if (watchedRecordId) {
        await supabase.from('watched').update(dataToSave).eq('id', watchedRecordId);
        return watchedRecordId;
      } else {
        const { data: newWatchedRecord } = await supabase.from('watched').insert(dataToSave).select().maybeSingle();
        if (!newWatchedRecord) return null;
        try {
          const { data: bookmark } = await supabase.from('bookmarks').select('*').eq('id', bookmarkId).maybeSingle();
          const currentHistory: string[] = (bookmark?.watchHistory as any) || [];
          const newHistory = Array.isArray(currentHistory) ? [...currentHistory, newWatchedRecord.id] : [newWatchedRecord.id];
          await supabase.from('bookmarks').update({ watchHistory: newHistory }).eq('id', bookmarkId);
        } catch (error) {
          console.error('Error updating bookmark with new watch record:', error);
          return null;
        }
        return newWatchedRecord.id;
      }
    } catch (error) {
      console.error("Error syncing watch progress:", error);
      return watchedRecordId;
    }
  };

  return {
    bookmarks,
    syncWatchProgress,
    createOrUpdateBookMark,
    totalPages,
    isLoading,
  };
}

export default useBookMarks;
