import { getCachedAnimeSchedule } from "@/lib/anime-data";
import { IAnimeSchedule } from "@/types/anime-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY_SCHEDULE: IAnimeSchedule = {
  scheduledAnimes: [],
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { searchParams } = url;
  const date = searchParams.get("date");
  const parsedDate = date ? new Date(date) : new Date();
  const formattedDate = Number.isNaN(parsedDate.getTime())
    ? new Date().toISOString().split("T")[0]
    : parsedDate.toISOString().split("T")[0];

  try {
    const data = await getCachedAnimeSchedule(formattedDate);
    return Response.json(
      { data },
      {
        headers: {
          "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800",
        },
      },
    );
  } catch (err) {
    console.error("[SCHEDULE_API] Returning empty schedule after failure:", err);
    return Response.json(
      { data: EMPTY_SCHEDULE, degraded: true },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  }
}
