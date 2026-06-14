export type BeezIDStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface BeezIDClientConfig {
  appId: string;
  beezIdUrl: string;
  redirectUri: string;
  storage?: BeezIDStorage;
  useMockSession?: boolean;
  minimumPermissions?: string[];
  fetcher?: typeof fetch;
}

export interface BeezIDRedirectOptions {
  state?: string;
  redirectUri?: string;
  minimumPermissions?: string[];
}

export interface BeezIDCallbackResult {
  status: 'authenticated' | 'not_authorized' | 'cancelled' | 'error';
  app?: string;
  state?: string;
  error?: string;
}

export interface BeezIDSession {
  appId: string;
  status: BeezIDCallbackResult['status'];
  state?: string;
  token?: string;
  createdAt: string;
}

export interface BeezUser {
  id: string;
  email?: string;
  [key: string]: unknown;
}

export interface BeezOrganization {
  id: string;
  slug: string;
  name: string;
  metadata?: Record<string, unknown>;
}

export interface BeezApplication {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
}

export interface BeezRole {
  id: string;
  slug: string;
  name: string;
  organizationId?: string | null;
}

export interface BeezContext {
  user: BeezUser | null;
  activeOrganization: BeezOrganization | null;
  organizations: BeezOrganization[];
  apps: BeezApplication[];
  roles: BeezRole[];
  permissions: string[];
}

export interface BeezIDState {
  session: BeezIDSession | null;
  context: BeezContext | null;
  isLoading: boolean;
  error: Error | null;
}

export interface BeezIDContextValue extends BeezIDState {
  client: import('./client').BeezIDClient;
  refreshContext: () => Promise<BeezContext | null>;
  login: (options?: BeezIDRedirectOptions) => void;
  register: (options?: BeezIDRedirectOptions) => void;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasAppAccess: (appId?: string) => boolean;
  setActiveOrganization: (organizationId: string) => Promise<void>;
}
