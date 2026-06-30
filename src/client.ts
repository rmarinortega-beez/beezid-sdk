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
const REFRESH_SKEW_MS = 60_000;

class BeezIDRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class BeezIDClient {
  readonly appId: string;
  readonly beezIdUrl: string;
  readonly redirectUri: string;

  private readonly storage: BeezIDStorage;
  private readonly fetcher: typeof fetch;
  private readonly useMockSession: boolean;
  private readonly minimumPermissions: string[];
  private refreshInFlight: Promise<BeezIDSession> | null = null;

  constructor(config: BeezIDClientConfig) {
    this.appId = config.appId;
    this.beezIdUrl = config.beezIdUrl.replace(/\/$/, '');
    this.redirectUri = config.redirectUri;
    this.storage = resolveStorage(config.storage);
    this.fetcher = config.fetcher ?? fetch.bind(globalThis);
    this.useMockSession = Boolean(config.useMockSession);
    this.minimumPermissions = config.minimumPermissions ?? [`${config.appId}.access`];
  }

  async buildLoginUrl(options: BeezIDRedirectOptions = {}): Promise<string> {
    return this.buildAuthorizationUrl('/login', options);
  }

  async buildRegisterUrl(options: BeezIDRedirectOptions = {}): Promise<string> {
    return this.buildAuthorizationUrl('/register', options, true);
  }

  async login(options?: BeezIDRedirectOptions): Promise<void> {
    this.redirect(await this.buildLoginUrl(options));
  }

  async register(options?: BeezIDRedirectOptions): Promise<void> {
    this.redirect(await this.buildRegisterUrl(options));
  }

  async handleCallback(callbackUrl = this.currentUrl()): Promise<BeezIDCallbackResult> {
    const url = new URL(callbackUrl);
    const state = url.searchParams.get('state') ?? undefined;
    const status = (url.searchParams.get('beezid_status') ?? 'error') as BeezIDCallbackResult['status'];
    const error = url.searchParams.get('error') ?? undefined;
    const app = url.searchParams.get('app') ?? undefined;
    const legacyToken = url.searchParams.get('beezid_token') ?? undefined;
    const authorizationCode = url.searchParams.get('code') ?? undefined;

    if (state && this.storage.getItem(this.stateKey(state)) !== state) {
      return { status: 'error', state, app, error: 'Invalid BeezID state' };
    }

    const result: BeezIDCallbackResult = { status, state, app, error };
    if (status === 'authenticated') {
      if (authorizationCode && state) {
        const codeVerifier = this.storage.getItem(this.verifierKey(state));
        if (!codeVerifier) {
          return { ...result, status: 'error', error: 'Missing BeezID PKCE verifier' };
        }
        const session = await this.exchangeAuthorizationCode(authorizationCode, codeVerifier);
        this.setSession(session);
      } else if (legacyToken) {
        this.setSession({
          appId: this.appId,
          status,
          state,
          token: legacyToken,
          createdAt: new Date().toISOString(),
        });
      } else {
        return { ...result, status: 'error', error: 'BeezID callback is missing credentials' };
      }
    }

    if (state) {
      this.storage.removeItem(this.stateKey(state));
      this.storage.removeItem(this.verifierKey(state));
    }
    return result;
  }

  getSession(): BeezIDSession | null {
    if (this.useMockSession) {
      return {
        appId: this.appId,
        status: 'authenticated',
        createdAt: new Date(0).toISOString(),
        expiresAt: new Date(8640000000000000).toISOString(),
      };
    }
    return this.readJson<BeezIDSession>(SESSION_KEY);
  }

  setSession(session: BeezIDSession): void {
    this.storage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  clearSession(): void {
    this.storage.removeItem(SESSION_KEY);
    this.storage.removeItem(CONTEXT_KEY);
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

  async refreshSession(force = false): Promise<BeezIDSession> {
    const current = this.getSession();
    if (!force && current && this.isSessionFresh(current)) return current;
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = this.requestSession('/api/beezid/session/refresh', {
      appId: this.appId,
    })
      .then((session) => {
        this.setSession(session);
        return session;
      })
      .catch((error) => {
        this.clearSession();
        throw error;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });

    return this.refreshInFlight;
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
    const token = this.getSession()?.token;
    if (!this.useMockSession) {
      await this.fetcher(new URL('/api/beezid/logout', this.beezIdUrl), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ appId: this.appId }),
      }).catch(() => undefined);
    }
    this.clearSession();
  }

  private async buildAuthorizationUrl(
    path: '/login' | '/register',
    options: BeezIDRedirectOptions,
    includePermissions = false,
  ): Promise<string> {
    const state = options.state ?? this.createState();
    const codeVerifier = this.createCodeVerifier();
    const codeChallenge = await this.createCodeChallenge(codeVerifier);
    const redirectUri = options.redirectUri ?? this.redirectUri;
    this.storage.setItem(this.stateKey(state), state);
    this.storage.setItem(this.verifierKey(state), codeVerifier);

    const url = new URL(path, this.beezIdUrl);
    url.searchParams.set('app', this.appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    if (includePermissions) {
      const permissions = options.minimumPermissions ?? this.minimumPermissions;
      url.searchParams.set('minimum_permissions', permissions.join(','));
    }
    return url.toString();
  }

  private async exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<BeezIDSession> {
    return this.requestSession('/api/beezid/session/token', {
      appId: this.appId,
      code,
      codeVerifier,
      redirectUri: this.redirectUri,
    });
  }

  private async requestSession(path: string, body: Record<string, string>): Promise<BeezIDSession> {
    const response = await this.fetcher(new URL(path, this.beezIdUrl), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new BeezIDRequestError(`BeezID session request failed: ${response.status}`, response.status);
    }
    const payload = await response.json() as { accessToken?: string; expiresAt?: string };
    if (!payload.accessToken || !payload.expiresAt) {
      throw new Error('BeezID session response is incomplete');
    }
    return {
      appId: this.appId,
      status: 'authenticated',
      token: payload.accessToken,
      createdAt: new Date().toISOString(),
      expiresAt: payload.expiresAt,
    };
  }

  private async request<T = void>(path: string, init: RequestInit = {}, canRetry = true): Promise<T> {
    const session = await this.ensureSession();
    const response = await this.fetcher(new URL(path, this.beezIdUrl), {
      credentials: 'include',
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(session.token ? { authorization: `Bearer ${session.token}` } : {}),
        ...init.headers,
      },
    });

    if (response.status === 401 && canRetry) {
      await this.refreshSession(true);
      return this.request<T>(path, init, false);
    }
    if (!response.ok) {
      if (response.status === 401) this.clearSession();
      throw new BeezIDRequestError(`BeezID request failed: ${response.status}`, response.status);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private async ensureSession(): Promise<BeezIDSession> {
    const session = this.getSession();
    if (!session) throw new BeezIDRequestError('BeezID session is missing', 401);
    if (this.isSessionFresh(session)) return session;
    return this.refreshSession(true);
  }

  private isSessionFresh(session: BeezIDSession): boolean {
    if (!session.expiresAt) return true;
    return new Date(session.expiresAt).getTime() - Date.now() > REFRESH_SKEW_MS;
  }

  private redirect(url: string): void {
    if (typeof window === 'undefined') throw new Error('BeezID redirects require a browser environment');
    window.location.assign(url);
  }

  private currentUrl(): string {
    if (typeof window === 'undefined') throw new Error('BeezID callback handling requires a browser URL');
    return window.location.href;
  }

  private createState(): string {
    return this.randomBase64Url(24);
  }

  private createCodeVerifier(): string {
    return this.randomBase64Url(48);
  }

  private async createCodeChallenge(verifier: string): Promise<string> {
    if (!globalThis.crypto?.subtle) throw new Error('BeezID PKCE requires Web Crypto');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return this.bytesToBase64Url(new Uint8Array(digest));
  }

  private randomBase64Url(length: number): string {
    if (!globalThis.crypto?.getRandomValues) throw new Error('BeezID authentication requires secure randomness');
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return this.bytesToBase64Url(bytes);
  }

  private bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private stateKey(state: string): string {
    return `beezid.state.${this.appId}.${state}`;
  }

  private verifierKey(state: string): string {
    return `beezid.verifier.${this.appId}.${state}`;
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
