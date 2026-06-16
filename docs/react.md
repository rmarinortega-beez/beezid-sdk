# React API

## BeezIDProvider

Wrap the consumer app:

```tsx
<BeezIDProvider
  appId="gravity"
  beezIdUrl="https://id.beezprojects.com"
  redirectUri="https://gravity.beezprojects.com/auth/beezid/callback"
>
  <App />
</BeezIDProvider>
```

## Hooks

- `useBeezID()`: full SDK state and actions.
- `useBeezSession()`: lightweight SDK session.
- `useBeezUser()`: current Beez user from context.
- `useBeezOrganization()`: active organization.
- `useBeezPermission(permission)`: local permission check.

On the consumer callback route, use the provider action so React state is hydrated:

```tsx
const { handleCallback } = useBeezID();

useEffect(() => {
  handleCallback(window.location.href);
}, [handleCallback]);
```

## PermissionGate

```tsx
<BeezPermissionGate permission="gravity.players.read" fallback={null}>
  <PlayersPanel />
</BeezPermissionGate>
```

You can also gate by app:

```tsx
<BeezPermissionGate appId="gravity">
  <GravityArea />
</BeezPermissionGate>
```

## Mock Session

For isolated frontend development:

```tsx
<BeezIDProvider
  appId="gravity"
  beezIdUrl="http://localhost:5173"
  redirectUri="http://localhost:3000/auth/beezid/callback"
  useMockSession
>
  <App />
</BeezIDProvider>
```
