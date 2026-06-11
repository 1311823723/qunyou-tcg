const LOCAL_BATTLE_API_URL = "http://localhost:8787";

export function getBattleApiUrl(): string {
  const configuredUrl = import.meta.env.PUBLIC_BATTLE_API_URL?.trim();
  if (import.meta.env.DEV) {
    return (configuredUrl || LOCAL_BATTLE_API_URL).replace(/\/+$/, "");
  }

  return new URL("/api/battle", location.origin).toString().replace(/\/+$/, "");
}
