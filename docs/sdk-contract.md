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

BeezID returns:

```text
{redirectUri}?state={state}&beezid_status=authenticated
```

or:

```text
{redirectUri}?state={state}&beezid_status=not_authorized&app={appId}
```

The SDK validates the state it generated and stores a lightweight SDK session. This is not a Supabase Auth session.

## HTTP Surface

The SDK expects BeezID to expose HTTP endpoints that wrap its public RPC contract:

- `GET /api/beezid/context`
- `POST /api/beezid/active-organization`
- `POST /api/beezid/permissions/check`
- `POST /api/beezid/apps/check`
- `POST /api/beezid/logout`

The requests use `credentials: include` so BeezID can rely on its own first-party session/cookie strategy.

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
