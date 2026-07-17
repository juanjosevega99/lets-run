/**
 * Strava OAuth2 (authorization code + refresh). Scope is activity:read_all so
 * private activities are included — without it the API silently omits them.
 */

const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const SCOPE = "activity:read_all";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAtS: number;
  athleteId: number | null;
}

export function buildAuthorizeUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: SCOPE,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });
  return toTokenSet(res, "code exchange");
}

export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  return toTokenSet(res, "token refresh");
}

async function toTokenSet(res: Response, what: string): Promise<TokenSet> {
  if (!res.ok) {
    throw new Error(`Strava ${what} failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete?: { id: number };
  };
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAtS: body.expires_at,
    athleteId: body.athlete?.id ?? null,
  };
}
