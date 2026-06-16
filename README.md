# @beez-projects/beezid

Client SDK for BeezID.

This package is not the identity authority. BeezID owns login, Supabase Auth, users, organizations, applications, roles and permissions. The SDK only consumes the public BeezID contract from consumer apps such as Gravity, BMManager and Flow.

## Install

```bash
npm install @beez-projects/beezid
```

## Core Client

```ts
import { BeezIDClient } from '@beez-projects/beezid';

const beezId = new BeezIDClient({
  appId: 'gravity',
  beezIdUrl: 'https://id.beezprojects.com',
  redirectUri: 'https://gravity.beezprojects.com/auth/beezid/callback',
});

beezId.login();
```

## React

```tsx
import { BeezIDProvider, BeezPermissionGate, useBeezID } from '@beez-projects/beezid/react';

export function App() {
  return (
    <BeezIDProvider
      appId="gravity"
      beezIdUrl="https://id.beezprojects.com"
      redirectUri="https://gravity.beezprojects.com/auth/beezid/callback"
    >
      <GravityApp />
    </BeezIDProvider>
  );
}

function GravityApp() {
  const { context, login, register, logout } = useBeezID();

  if (!context) {
    return (
      <>
        <button onClick={() => login()}>Login BeezID</button>
        <button onClick={() => register()}>Registro BeezID</button>
      </>
    );
  }

  return (
    <BeezPermissionGate permission="gravity.*">
      <button onClick={() => logout()}>Logout</button>
    </BeezPermissionGate>
  );
}
```

## Callback

```ts
const { handleCallback } = useBeezID();

const result = await handleCallback(window.location.href);
```

The callback stores the opaque `beezid_token` returned by BeezID. The SDK sends that token to BeezID HTTP endpoints; consumer apps do not need Supabase Auth credentials.

## Config

- `appId`: slug de la aplicacion consumidora.
- `beezIdUrl`: URL publica de BeezID.
- `redirectUri`: callback de la aplicacion consumidora.
- `storage`: storage compatible con `localStorage`.
- `useMockSession`: modo local sin BeezID real.
- `minimumPermissions`: permisos minimos solicitados durante registro.

## Boundaries

The SDK does not:

- Talk directly to Supabase Auth.
- Know BeezID internal tables.
- Implement login UI.
- Replace BeezID authorization rules.
- Install `@supabase/supabase-js`.

## Docs

- `docs/sdk-contract.md`
- `docs/react.md`
