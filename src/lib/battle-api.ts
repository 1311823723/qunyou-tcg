const LOCAL_BATTLE_API_URL = "http://localhost:8787";
const PRODUCTION_BATTLE_API_URL =
  "https://qunyou-tcg-battle.dc-delivery-copilot-1311823723.workers.dev";

export function getBattleApiUrl(): string {
  const configuredUrl = import.meta.env.PUBLIC_BATTLE_API_URL?.trim();
  const fallbackUrl = import.meta.env.DEV
    ? LOCAL_BATTLE_API_URL
    : PRODUCTION_BATTLE_API_URL;

  return (configuredUrl || fallbackUrl).replace(/\/+$/, "");
}
