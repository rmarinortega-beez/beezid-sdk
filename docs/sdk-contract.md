# BeezID SDK Contract

The SDK consumes BeezID as a remote authority. It does not know Supabase tables and does not authenticate users by itself.

## Redirects

Login:

```text
GET {beezIdUrl}/login?app={appId}&redirect_uri={redirectUri}&state={state}
```

Register:

```text
GET {beezIdUrl}/register?app={appId}&redirect_uri={redirectUri}&state={state}&minimum_permissions={permissions}
```

`minimum_permissions` is a comma-separated list. By default the SDK requests:

```text
{appId}.access
```

BeezID is responsible for deciding how those minimum permissions are assigned after registration.

## Callback

BeezID returns a one-time authorization code:

```text
{redirectUri}?state={state}&beezid_status=authenticated&code={authorizationCode}
```

or:

```text
{redirectUri}?state={state}&beezid_status=not_authorized&app={appId}
```

The SDK validates the state, exchanges the code with its PKCE verifier and stores a lightweight SDK session. This is not a Supabase Auth session.

The resulting access token is short lived. The SDK stores it and sends it as:

```text
Authorization: Bearer {token}
```

to BeezID HTTP endpoints. BeezID keeps the renewable credential in an HttpOnly cookie scoped to its API. The SDK calls `/api/beezid/session/refresh` before expiry and retries at most once after a 401.

## HTTP Surface

The SDK expects BeezID to expose HTTP endpoints that wrap its public RPC contract:

- `GET /api/beezid/context`
- `POST /api/beezid/active-organization`
- `POST /api/beezid/permissions/check`
- `POST /api/beezid/apps/check`
- `POST /api/beezid/logout`
- `POST /api/beezid/session/token`
- `POST /api/beezid/session/refresh`

Authorized API requests use the opaque Bearer access token and `credentials: include` so the refresh endpoint can use the server-managed HttpOnly cookie. BeezID must return an exact allowed origin and `Access-Control-Allow-Credentials: true`.

## BeezContext

```ts
interface BeezContext {
  user: BeezUser | null;
  activeOrganization: BeezOrganization | null;
  organizations: BeezOrganization[];
  apps: BeezApplication[];
  roles: BeezRole[];
  permissions: string[];
}
```

## Permission Checks

Local checks use the loaded context and support:

- Exact permission match.
- App wildcard match, for example `gravity.*`.
- Global Beez owner wildcard, `beez.*`.

Remote checks call BeezID endpoints and should be used when freshness matters.
