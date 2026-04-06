export const PRIMARY_STREAM_PROVIDER_DOMAIN = "aniwatchtv.to";
export const GOGOANIME_BACKUP_SERVER_NAME = "gogoanime.by";

export function isGogoBackupServerName(value?: string | null) {
  return String(value || "").trim().toLowerCase() === GOGOANIME_BACKUP_SERVER_NAME;
}
