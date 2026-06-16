import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BeezIDClient } from './client';
import type { BeezContext, BeezIDCallbackResult, BeezIDClientConfig, BeezIDContextValue, BeezIDRedirectOptions, BeezIDSession } from './types';

const BeezReactContext = createContext<BeezIDContextValue | null>(null);

export interface BeezIDProviderProps extends BeezIDClientConfig {
  children: ReactNode;
  autoLoadContext?: boolean;
}

export function BeezIDProvider({ children, autoLoadContext = true, ...config }: BeezIDProviderProps) {
  const client = useMemo(() => new BeezIDClient(config), [config.appId, config.beezIdUrl, config.redirectUri, config.storage, config.useMockSession]);
  const [session, setSession] = useState<BeezIDSession | null>(() => client.getSession());
  const [context, setContext] = useState<BeezContext | null>(() => client.getStoredContext());
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refreshContext = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextContext = await client.getContext();
      setContext(nextContext);
      setSession(client.getSession());
      return nextContext;
    } catch (refreshError) {
      const nextError = refreshError instanceof Error ? refreshError : new Error('Unable to refresh BeezID context');
      setError(nextError);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  const handleCallback = useCallback(
    async (callbackUrl?: string): Promise<BeezIDCallbackResult> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = client.handleCallback(callbackUrl);
        setSession(client.getSession());

        if (result.status === 'authenticated') {
          const nextContext = await client.getContext();
          setContext(nextContext);
        }

        return result;
      } catch (callbackError) {
        const nextError = callbackError instanceof Error ? callbackError : new Error('Unable to handle BeezID callback');
        setError(nextError);
        return { status: 'error', error: nextError.message };
      } finally {
        setIsLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    if (autoLoadContext && session) {
      refreshContext();
    }
  }, [autoLoadContext, refreshContext, session]);

  const value = useMemo<BeezIDContextValue>(
    () => ({
      client,
      session,
      context,
      isLoading,
      error,
      handleCallback,
      refreshContext,
      login: (options?: BeezIDRedirectOptions) => client.login(options),
      register: (options?: BeezIDRedirectOptions) => client.register(options),
      logout: async () => {
        await client.logout();
        setSession(null);
        setContext(null);
      },
      hasPermission: (permission: string) =>
        Boolean(context?.permissions.some((candidate) => candidate === permission || candidate === `${permission.split('.')[0]}.*` || candidate === 'beez.*')),
      hasAppAccess: (appId = config.appId) => Boolean(context?.apps.some((app) => app.slug === appId)),
      setActiveOrganization: async (organizationId: string) => {
        await client.setActiveOrganization(organizationId);
        await refreshContext();
      },
    }),
    [client, config.appId, context, error, handleCallback, isLoading, refreshContext, session],
  );

  return <BeezReactContext.Provider value={value}>{children}</BeezReactContext.Provider>;
}

export function useBeezID(): BeezIDContextValue {
  const value = useContext(BeezReactContext);
  if (!value) throw new Error('useBeezID must be used inside BeezIDProvider');
  return value;
}

export function useBeezSession() {
  return useBeezID().session;
}

export function useBeezUser() {
  return useBeezID().context?.user ?? null;
}

export function useBeezOrganization() {
  return useBeezID().context?.activeOrganization ?? null;
}

export function useBeezPermission(permission: string): boolean {
  return useBeezID().hasPermission(permission);
}

export interface BeezPermissionGateProps {
  permission?: string;
  appId?: string;
  fallback?: ReactNode;
  children: ReactNode;
}

export function BeezPermissionGate({ appId, children, fallback = null, permission }: BeezPermissionGateProps) {
  const beezId = useBeezID();
  const hasPermission = permission ? beezId.hasPermission(permission) : true;
  const hasAppAccess = appId ? beezId.hasAppAccess(appId) : true;
  return hasPermission && hasAppAccess ? <>{children}</> : <>{fallback}</>;
}

export { BeezIDClient };
export type {
  BeezApplication,
  BeezContext,
  BeezIDCallbackResult,
  BeezIDClientConfig,
  BeezIDContextValue,
  BeezIDRedirectOptions,
  BeezIDSession,
  BeezIDState,
  BeezIDStorage,
  BeezOrganization,
  BeezRole,
  BeezUser,
} from './types';
