import { resolveStorage } from './storage';
import type {
  BeezContext,
  BeezIDCallbackResult,
  BeezIDClientConfig,
  BeezIDRedirectOptions,
  BeezIDSession,
  BeezIDStorage,
} from './types';

const SESSION_KEY = 'beezid.session';
const CONTEXT_KEY = 'beezid.context';

export class BeezIDClient {
  readonly appId: string;
  readonly beezIdUrl: string;
  readonly redirectUri: string;

  private readonly storage: BeezIDStorage;
  private readonly fetcher: typeof fetch;
  private readonly useMockSession: boolean;
  private readonly minimumPermissions: string[];

  constructor(config: BeezIDClientConfig) {
    this.appId = config.appId;
    this.beezIdUrl = config.beezIdUrl.replace(/\/$/, '');
    this.redirectUri = config.redirectUri;
    this.storage = resolveStorage(config.storage);
    this.fetcher = config.fetcher ?? fetch.bind(globalThis);
    this.useMockSession = Boolean(config.useMockSession);
    this.minimumPermissions = config.minimumPermissions ?? [`${config.appId}.access`];
  }

  buildLoginUrl(options: BeezIDRedirectOptions = {}): string {
    const state = options.state ?? this.createState();
    this.storage.setItem(this.stateKey(state), state);
    const url = new URL('/login', this.beezIdUrl);
    url.searchParams.set('app', this.appId);
    url.searchParams.set('redirect_uri', options.redirectUri ?? this.redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  buildRegisterUrl(options: BeezIDRedirectOptions = {}): string {
    const state = options.state ?? this.createState();
    const permissions = options.minimumPermissions ?? this.minimumPermissions;
    this.storage.setItem(this.stateKey(state), state);
    const url = new URL('/register', this.beezIdUrl);
    url.searchParams.set('app', this.appId);
    url.searchParams.set('redirect_uri', options.redirectUri ?? this.redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('minimum_permissions', permissions.join(','));
    return url.toString();
  }

  login(options?: BeezIDRedirectOptions): void {
    this.redirect(this.buildLoginUrl(options));
  }

  register(options?: BeezIDRedirectOptions): void {
    this.redirect(this.buildRegisterUrl(options));
  }

  handleCallback(callbackUrl = this.currentUrl()): BeezIDCallbackResult {
    const url = new URL(callbackUrl);
    const state = url.searchParams.get('state') ?? undefined;
    const status = (url.searchParams.get('beezid_status') ?? 'error') as BeezIDCallbackResult['status'];
    const error = url.searchParams.get('error') ?? undefined;
    const app = url.searchParams.get('app') ?? undefined;

    if (state && this.storage.getItem(this.stateKey(state)) !== state) {
      return { status: 'error', state, app, error: 'Invalid BeezID state' };
    }

    const result: BeezIDCallbackResult = { status, state, app, error };
    if (state) this.storage.removeItem(this.stateKey(state));

    if (status === 'authenticated') {
      this.setSession({
        appId: this.appId,
        status,
        state,
        createdAt: new Date().toISOString(),
      });
    }

    return result;
  }

  getSession(): BeezIDSession | null {
    if (this.useMockSession) {
      return {
        appId: this.appId,
        status: 'authenticated',
        createdAt: new Date(0).toISOString(),
      };
    }

    return this.readJson<BeezIDSession>(SESSION_KEY);
  }

  setSession(session: BeezIDSession): void {
    this.storage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  getStoredContext(): BeezContext | null {
    if (this.useMockSession) return this.mockContext();
    return this.readJson<BeezContext>(CONTEXT_KEY);
  }

  async getContext(): Promise<BeezContext | null> {
    if (this.useMockSession) {
      const context = this.mockContext();
      this.storage.setItem(CONTEXT_KEY, JSON.stringify(context));
      return context;
    }

    const context = await this.request<BeezContext>('/api/beezid/context');
    this.storage.setItem(CONTEXT_KEY, JSON.stringify(context));
    return context;
  }

  async setActiveOrganization(organizationId: string): Promise<void> {
    await this.request('/api/beezid/active-organization', {
      method: 'POST',
      body: JSON.stringify({ organization_id: organizationId }),
    });
    await this.getContext();
  }

  async checkPermission(permission: string, organizationId?: string): Promise<boolean> {
    if (this.useMockSession) return this.hasPermission(permission);
    const result = await this.request<{ allowed: boolean }>('/api/beezid/permissions/check', {
      method: 'POST',
      body: JSON.stringify({ permission_key: permission, organization_id: organizationId ?? null }),
    });
    return result.allowed;
  }

  async checkAppAccess(appId = this.appId, organizationId?: string): Promise<boolean> {
    if (this.useMockSession) return this.hasAppAccess(appId);
    const result = await this.request<{ allowed: boolean }>('/api/beezid/apps/check', {
      method: 'POST',
      body: JSON.stringify({ app_slug: appId, organization_id: organizationId ?? null }),
    });
    return result.allowed;
  }

  hasPermission(permission: string): boolean {
    const context = this.getStoredContext();
    return Boolean(
      context?.permissions.some((candidate) => candidate === permission || candidate === `${permission.split('.')[0]}.*` || candidate === 'beez.*'),
    );
  }

  hasAppAccess(appId = this.appId): boolean {
    const context = this.getStoredContext();
    return Boolean(context?.apps.some((app) => app.slug === appId));
  }

  async logout(): Promise<void> {
    this.storage.removeItem(SESSION_KEY);
    this.storage.removeItem(CONTEXT_KEY);
    if (!this.useMockSession) {
      await this.request('/api/beezid/logout', { method: 'POST' }).catch(() => undefined);
    }
  }

  private async request<T = void>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(new URL(path, this.beezIdUrl), {
      credentials: 'include',
      ...init,
      headers: {
        'content-type': 'application/json',
        ...init.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`BeezID request failed: ${response.status}`);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private redirect(url: string): void {
    if (typeof window === 'undefined') {
      throw new Error('BeezID redirects require a browser environment');
    }
    window.location.assign(url);
  }

  private currentUrl(): string {
    if (typeof window === 'undefined') {
      throw new Error('BeezID callback handling requires a browser URL');
    }
    return window.location.href;
  }

  private createState(): string {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private stateKey(state: string): string {
    return `beezid.state.${this.appId}.${state}`;
  }

  private readJson<T>(key: string): T | null {
    const value = this.storage.getItem(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      this.storage.removeItem(key);
      return null;
    }
  }

  private mockContext(): BeezContext {
    return {
      user: { id: 'mock-user', email: 'mock@beez.local' },
      activeOrganization: { id: 'mock-org', slug: 'mock', name: 'Mock Organization' },
      organizations: [{ id: 'mock-org', slug: 'mock', name: 'Mock Organization' }],
      apps: [{ id: this.appId, slug: this.appId, name: this.appId, isActive: true }],
      roles: [{ id: 'owner', slug: 'owner', name: 'Owner' }],
      permissions: this.minimumPermissions,
    };
  }
}
