import Container from "./container";
import React, { useMemo, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { useGetAnimeSchedule } from "@/query/get-anime-schedule";
import Button from "./common/custom-button";
import Link from "next/link";
import { ROUTES } from "@/constants/routes";

const DAYS_OF_WEEK = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function AnimeSchedule() {
  const currentDate = useMemo(() => new Date(), []);
  const currentDay = useMemo(
    () => currentDate.toLocaleString("en-US", { weekday: "long" }).toLowerCase(),
    [currentDate]
  );
  const currentDayIndex = useMemo(() => currentDate.getDay(), [currentDate]);
  
  const [currentSelectedTab, setCurrentSelectedTab] = React.useState<string>(currentDay);
  const defaultTab = DAYS_OF_WEEK.includes(currentDay as any) ? currentDay : "monday";

  const getDateForWeekday = useCallback((targetDay: string) => {
    const targetIndex = DAYS_OF_WEEK.indexOf(targetDay as any);
    const date = new Date(currentDate);
    const diff = targetIndex - currentDayIndex;
    date.setDate(currentDate.getDate() + diff);
    return date;
  }, [currentDate, currentDayIndex]);

  const selectedDate = useMemo(() => {
    const date = getDateForWeekday(currentSelectedTab);
    date.setDate(date.getDate() + 1); // idk why i had to add 1 day, but the schedule API returns the next day
    return date.toLocaleDateString("en-US");
  }, [currentSelectedTab, getDateForWeekday]);

  const { isLoading, data } = useGetAnimeSchedule(selectedDate);

  return (
    <Container className="flex flex-col gap-5 py-10 items-center lg:items-start">
      <h5 className="text-2xl font-bold">Schedule</h5>
      <Tabs
        orientation="vertical"
        defaultValue={defaultTab}
        onValueChange={(val) => setCurrentSelectedTab(val)}
        value={currentSelectedTab}
        className="w-full"
        key="anime-schedule-tabs"
      >
        <TabsList className="grid w-full grid-cols-7">
          {DAYS_OF_WEEK.map((day) => {
            const date = getDateForWeekday(day);
            const formattedDate = date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
            
            return (
              <TabsTrigger key={day} value={day}>
                {day.substring(0, 3).toUpperCase()} - {formattedDate}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {isLoading ? (
          <LoadingSkeleton />
        ) : (
          DAYS_OF_WEEK.map((day) => (
            <TabsContent key={day} value={day}>
              {day === currentSelectedTab && (
                <div className="flex flex-col gap-5 w-full p-4">
                  {data?.scheduledAnimes.map((anime) => (
                    <div
                      key={anime.id}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-x-5">
                        <h3 className="text-sm text-gray-300 font-semibold">
                          {new Date(anime.airingTimestamp).toLocaleTimeString(
                            "en-US",
                            {
                              hour: "numeric",
                              minute: "2-digit",
                              hour12: true,
                            },
                          )}
                        </h3>
                        <h3 className="text-sm font-semibold">{anime.name}</h3>
                      </div>
                      <Link href={`${ROUTES.ANIME_DETAILS}/${anime.id}`}>
                        <Button
                          className="w-[8rem] bg-[#e9376b] text-white hover:bg-[#e9376b]"
                          size="sm"
                        >
                          Episode {anime.episode}
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          ))
        )}
      </Tabs>
    </Container>
  );
}

const LoadingSkeleton = () => {
  return (
    <Container className="flex flex-col gap-5 py-10 items-center lg:items-start">
      <div className="h-14 w-full animate-pulse bg-slate-700"></div>
      <div className="h-14 w-full animate-pulse bg-slate-700"></div>
      <div className="h-14 w-full animate-pulse bg-slate-700"></div>
      <div className="h-14 w-full animate-pulse bg-slate-700"></div>
    </Container>
  );
};

export default AnimeSchedule;
