import { IEpisodeServers } from "@/types/episodes";

type Preference = {
  serverName: string;
  key: "sub" | "dub" | "raw";
};

export function getFallbackServer(serversData: IEpisodeServers | undefined): {
  serverName: string;
  key: string;
} {
  const preference = localStorage.getItem("serverPreference");

  if (preference) {
    const parsedPreference = JSON.parse(preference) as Partial<Preference>;
    if (parsedPreference?.key) {
      const serverList = serversData?.[parsedPreference.key];
      const preferredServer = parsedPreference.serverName
        ? serverList?.find(
            (server) => server.serverName === parsedPreference.serverName,
          )
        : null;

      if (preferredServer?.serverName) {
        return {
          serverName: preferredServer.serverName,
          key: parsedPreference.key,
        };
      }

      if (serverList && serverList[0]?.serverName) {
        return {
          serverName: serverList[0].serverName,
          key: parsedPreference.key,
        };
      }
    }
  }

  if (serversData) {
    const keys: Array<"sub" | "dub" | "raw"> = ["sub", "dub", "raw"]; // Only valid keys
    for (const key of keys) {
      const serverList = serversData[key]; // Safely index the object
      if (serverList && serverList[0]?.serverName) {
        return {
          serverName: serverList[0].serverName,
          key,
        };
      }
    }
  }
  return {
    serverName: "",
    key: "",
  }; // Fallback if no valid server is found
}
