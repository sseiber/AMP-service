import { HapiPlugin, inject } from 'spryly';
import { Server, Request } from '@hapi/hapi';
import { ConfigService } from '../services/config';
import { AuthService } from '../services/auth';
import * as Bell from '@hapi/bell';
import * as HapiAuthCookie from '@hapi/cookie';
import * as HapiAuthJwt from 'hapi-auth-jwt2';
import {
    internal as boomInternal,
    unauthorized as boomUnauthorized
} from '@hapi/boom';
import { decode as jwtDecode } from 'jsonwebtoken';
import * as _get from 'lodash.get';
import * as oidcTokenHash from 'oidc-token-hash';
import { bind } from '../utils';

export class AuthPlugin implements HapiPlugin {
    @inject('$server')
    private server: Server;

    @inject('config')
    private config: ConfigService;

    @inject('auth')
    private auth: AuthService;

    public async register(server: Server) {
        try {
            await server.register([
                Bell,
                HapiAuthCookie,
                HapiAuthJwt
            ]);

            server.auth.strategy('ams-signin', 'bell', this.getAzureB2CStrategyProviderConfig(this.config.get('authAmsSigninPolicy'), 'bell-azureadb2c-signin'));

            server.auth.strategy('ams-profile', 'bell', this.getAzureB2CStrategyProviderConfig(this.config.get('authAmsProfilePolicy'), 'bell-azureadb2c-profile'));

            server.auth.strategy('ams-session', 'cookie', {
                cookie: {
                    name: 'sid-ams',
                    password: this.config.get('sessionAmsCookiePassword'),
                    path: '/',
                    isSecure: this.config.get('authForceHttps') === 'true'
                },
                requestDecoratorName: 'amsSessionAuth',
                redirectTo: '/',
                appendNext: true
            });

            server.auth.strategy('ams-jwt', 'jwt', {
                key: this.auth.serviceSecret,
                validate: this.validateServiceAccessTokenRequest,
                verifyOptions: {
                    issuer: this.auth.serviceIssuer
                }
            });
        }
        catch (ex) {
            this.server.log(['AuthPlugin', 'error'], 'Failed to register auth strategies');
        }
    }

    private getAzureB2CStrategyProviderConfig(policy: string, cookieName: string) {
        return {
            provider: {
                name: 'azureadb2c',
                protocol: 'oauth2',
                useParamsAuth: true,
                auth: this.config.get('authAmsAuthorizeUrl').replace('###POLICY', policy),
                token: this.config.get('authAmsTokenUrl').replace('###POLICY', policy),
                scope: [
                    'email',
                    'offline_access',
                    'openid',
                    'profile',
                    this.config.get('authAmsClientId')
                ],
                profile: this.getProfileInfo
            },
            password: this.config.get('authAmsCookiePassword'),
            clientId: this.config.get('authAmsClientId'),
            clientSecret: this.config.get('authAmsClientSecret'),
            forceHttps: this.config.get('authForceHttps'),
            location: (request) => {
                return this.setBaseRedirectUrl(request, this.config.get('authAmsSigninRedirectUrl'));
            },
            cookie: cookieName,
            isSecure: this.config.get('authForceHttps') === 'true'
        };
    }

    @bind
    // @ts-ignore (get)
    private async getProfileInfo(credentials, params, get) {
        try {
            const idTokenInfo = jwtDecode(params.id_token);

            if (!this.verifyAccessTokenHash(params.access_token, _get(idTokenInfo, 'at_hash'))) {
                throw boomUnauthorized(`Invalid access token`);
            }

            const userId = _get(idTokenInfo, 'oid') || '0';

            credentials.profile = {
                role: this.auth.serviceAdmins.includes(userId) ? 'admin' : 'api-client',
                id: userId,
                displayName: _get(idTokenInfo, 'name') || 'Unknown',
                email: _get(idTokenInfo, 'emails.0') || ''
            };
        }
        catch (ex) {
            throw boomInternal(`Failed to obtain user profile`, ex);
        }
    }

    private verifyAccessTokenHash(accessToken: string, hash: string): boolean {
        try {
            oidcTokenHash.validate({ claim: 'at_hash', source: 'access_token' }, hash, accessToken, 'RS256');
            return true;
        }
        catch (ex) {
            this.server.log(['AuthPlugin', 'error'], 'The access token could not be validated');
            return false;
        }
    }

    @bind
    // @ts-ignore (request, h)
    private async validateServiceAccessTokenRequest(decoded, request: Request, h: ResponseToolkit) {
        if (!decoded.id || !decoded.scope || !Array.isArray(decoded.scope)) {
            return {
                isValid: false
            };
        }

        return {
            isValid: true,
            credentials: {
                scope: decoded.scope
            }
        };
    }

    private setBaseRedirectUrl(request: Request, signinUrl: string) {
        const redirectProtocol = this.auth.getRedirectProtocol(request);
        const redirectHost = this.auth.getRedirectHost(request);
        if (redirectHost && redirectProtocol) {
            return `${redirectProtocol}://${redirectHost}${signinUrl}`;
        }

        return '';
    }
}
