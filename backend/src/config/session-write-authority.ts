export const SESSION_WRITE_AUTHORITIES = ["shared", "job", "eventsub"] as const;

export type SessionWriteAuthority = (typeof SESSION_WRITE_AUTHORITIES)[number];

const DEFAULT_SESSION_WRITE_AUTHORITY: SessionWriteAuthority = "job";

export function getSessionWriteAuthority(): SessionWriteAuthority {
  const value = (process.env.SESSION_WRITE_AUTHORITY || DEFAULT_SESSION_WRITE_AUTHORITY).toLowerCase();
  if (value === "shared" || value === "job" || value === "eventsub") {
    return value;
  }

  return DEFAULT_SESSION_WRITE_AUTHORITY;
}
