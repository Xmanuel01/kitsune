import React from "react";
import {
  Avatar as AvatarCN,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { env } from "next-runtime-env";
import { supabase } from "@/lib/supabaseClient";

type Props = {
  url?: string;
  username?: string;
  collectionID?: string;
  id?: string;
  className?: string;
  onClick?: () => void;
};

function Avatar({
  url,
  username,
  id,
  className,
  collectionID,
  onClick,
}: Props) {
  const supabaseBucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || "public";
  let src: string | undefined = undefined;
  if (collectionID && id && url) {
    try {
      const path = `${collectionID}/${id}/${url}`;
      const { data } = supabase.storage.from(supabaseBucket).getPublicUrl(path);
      src = data?.publicUrl ?? undefined;
    } catch (e) {
      src = undefined;
    }
  }

  return (
    <AvatarCN className={className} onClick={onClick}>
      <AvatarImage src={src} alt={username} />
      <AvatarFallback>
        {username?.charAt(0).toUpperCase()}
        {username?.charAt(1).toLowerCase()}
      </AvatarFallback>
    </AvatarCN>
  );
}

export default Avatar;
