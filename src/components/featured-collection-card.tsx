import React from "react";
import AnimeCard from "./anime-card";
import { IAnime } from "@/types/anime";
import { ROUTES } from "@/constants/routes";

type Props = {
  title: string;
  anime: IAnime[];
};

const cardPositions = [
  "absolute md:bottom-[-5.25rem] bottom-[-4.25rem] left-[15%] rotate-[-20deg] w-[9.375rem] border-[.50rem] border-[#212121]",
  "absolute md:bottom-[-6.25rem] bottom-[-5rem] rotate-[-10deg] left-[30%] w-[9.375rem] border-[.50rem] border-[#212121]",
  "absolute md:bottom-[-6.25rem] bottom-[-6rem] left-[45%] rotate-[5deg] w-[9.375rem] border-[.50rem] border-[#212121]",
] as const;

const FeaturedCollectionCard = (props: Props) => {
  const animeItems = props.anime.slice(0, cardPositions.length);

  if (animeItems.length === 0) {
    return null;
  }

  return (
    <div className=" h-[18.5rem] flex flex-col gap-2 items-center rounded-lg overflow-hidden bg-[#212121] w-full">
      <h5 className="text-lg font-semibold pt-5 text-center">{props.title}</h5>
      <div className="w-full relative grow flex">
        {animeItems.map((anime, index) => (
          <AnimeCard
            key={`${anime.id}-${index}`}
            title={anime.name}
            className={cardPositions[index]}
            subTitle={anime.episodes.sub?.toString()}
            poster={anime.poster}
            href={`${ROUTES.ANIME_DETAILS}/${anime.id}`}
          />
        ))}
      </div>
    </div>
  );
};

export default FeaturedCollectionCard;
