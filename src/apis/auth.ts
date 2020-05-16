import { inject, RoutePlugin, route } from 'spryly';
import { Server, Request, ResponseToolkit } from '@hapi/hapi';
import { ConfigService } from '../services/config';
import { AuthService } from '../services/auth';
import {
    badRequest as boomBadRequest,
    unauthorized as boomUnauthorized
} from '@hapi/boom';
import * as _get from 'lodash.get';
import { stringify as qsStringify } from 'query-string';

export class AuthRoutes extends RoutePlugin {
    @inject('$server')
    private server: Server;

    @inject('config')
    private config: ConfigService;

    @inject('auth')
    private auth: AuthService;

    @route({
        method: ['POST', 'GET'],
        path: '/api/v1/auth/signin',
        options: {
            auth: 'ams-signin',
            tags: ['auth'],
            description: 'Sign in with authenticated session'
        }
    })
    public async amsSignin(request: Request, h: ResponseToolkit) {
        return this.providerSignin(request, h);
    }

    @route({
        method: ['POST', 'GET'],
        path: '/api/v1/auth/profile',
        options: {
            auth: 'ams-profile',
            tags: ['auth'],
            description: 'Edit a user profile for authenticated session'
        }
    })
    public async amsProfile(request: Request, h: ResponseToolkit) {
        return this.providerSignin(request, h);
    }

    public async providerSignin(request: Request, h: ResponseToolkit) {
        const auth = request.auth;

        if (!auth || !auth.isAuthenticated) {
            const errorMessage = _get(request, 'auth.error.message') || 'unknown';
            this.server.log(['AuthRoutes', 'error'], `providerSignin error: ${errorMessage}`);

            throw boomUnauthorized(`Sign in auth check failed: ${errorMessage}`);
        }

        const credentials = _get(auth, 'credentials');

        if (!credentials) {
            this.server.log(['AuthRoutes', 'error'], 'providerSignin error: auth check failed: missing credentials');

            throw boomUnauthorized('Sign in auth check failed: missing credentials');
        }

        if (auth.isAuthenticated) {
            try {
                await this.auth.providerSignin(request, credentials);

                const queryParams = qsStringify({
                    ..._get(auth, 'credentials.query')
                });

                return h.redirect(`/user?${queryParams}`);
            }
            catch (ex) {
                this.server.log(['AuthRoutes', 'error'], ex.message);

                throw boomUnauthorized('Sorry something went wrong. Please try again.');
            }
        }
        else {
            throw boomUnauthorized('Try logging in again...');
        }
    }

    @route({
        method: 'GET',
        path: '/api/v1/auth/signout',
        options: {
            auth: {
                strategy: 'ams-session',
                scope: ['api-client']
            },
            tags: ['auth'],
            description: 'Sign out the authenticated session'
        }
    })
    public async getSignout(request: Request, h: ResponseToolkit) {
        this.server.log(['AuthRoutes', 'info'], 'getSignout');

        try {
            (request as any).amsSessionAuth.clear();
        }
        catch (ex) {
            this.server.log(['AuthRoutes', 'warning'], `Session cookie is already cleared: ${ex.message}`);
        }

        const redirectProtocol = this.auth.getRedirectProtocol(request);
        const redirectHost = this.auth.getRedirectHost(request);
        const signoutDoneRedirectUrl = `${redirectProtocol}://${redirectHost}${this.config.get('authSignoutDoneRedirectUrl')}`;
        const authSignoutUrl = this.config.get('authAmsSignoutUrl').replace('###POLICY', this.config.get('authAmsSigninPolicy'));

        return h.redirect(`${authSignoutUrl}${signoutDoneRedirectUrl}`);
    }

    @route({
        method: 'GET',
        path: '/api/v1/auth/signoutdone',
        options: {
            tags: ['auth'],
            description: 'Final redirect for session session'
        }
    })
    // @ts-ignore (request)
    public getSignoutDone(request: Request, h: ResponseToolkit) {
        return h.redirect('/');
    }

    @route({
        method: 'GET',
        path: '/api/v1/auth/user',
        options: {
            auth: {
                strategy: 'ams-session',
                mode: 'required'
            },
            plugins: {
                'hapi-auth-cookie': {
                    redirectTo: false
                }
            },
            tags: ['auth'],
            description: 'Get logged in user profile'
        }
    })
    // @ts-ignore (h)
    public getUserProfile(request: Request, h: ResponseToolkit) {
        const profile = _get(request, 'auth.credentials.profile');
        if (!profile || !_get(request, 'auth.isAuthenticated')) {
            throw boomUnauthorized();
        }

        return {
            role: profile.role,
            userId: _get(request, 'auth.credentials.userId'),
            displayName: profile.displayName,
            email: profile.email,
            authProvider: _get(request, 'auth.credentials.provider')
        };
    }

    @route({
        method: ['POST', 'GET'],
        path: '/api/v1/auth/generate',
        options: {
            auth: {
                strategies: ['ams-session'],
                scope: ['admin']
            },
            tags: ['auth'],
            description: 'Generate tokens'
        }
    })
    public async generate(request: Request, h: ResponseToolkit) {
        const payload: any = request.payload;

        if (!payload.scope) {
            throw boomBadRequest('Missing scope field in payload');
        }

        const tokenInfo = await this.auth.generateToken(payload.scope);

        return h.response(tokenInfo).code(201);
    }
}
