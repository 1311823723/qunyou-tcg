interface Env {
  BATTLE_SERVICE: Fetcher;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = sourceUrl.pathname.replace(/^\/api\/battle/, "") || "/";

  return env.BATTLE_SERVICE.fetch(new Request(targetUrl, request));
};
