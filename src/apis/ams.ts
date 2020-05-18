import { inject, RoutePlugin, route } from 'spryly';
import { Server, Request, ResponseToolkit } from '@hapi/hapi';
import { AmsService } from '../services/ams';
import { IAmsAccount } from '../models/amsAccount';
import {
    badRequest as boomBadRequest,
    unauthorized as boomUnauthorized
} from '@hapi/boom';
import * as _get from 'lodash.get';

export class AmsRoutes extends RoutePlugin {
    @inject('$server')
    private server: Server;

    @inject('ams')
    private ams: AmsService;

    @route({
        method: 'GET',
        path: '/api/v1/ams/user',
        options: {
            auth: {
                strategy: 'ams-session',
                mode: 'required',
                scope: ['api-client']
            },
            plugins: {
                'hapi-auth-cookie': {
                    redirectTo: false
                }
            },
            tags: ['ams'],
            description: 'Get logged in user identity'
        }
    })
    // @ts-ignore (h)
    public async getAmsUser(request: Request, h: ResponseToolkit) {
        this.server.log(['AmsRoutes', 'info'], 'getAmsUser');

        const user = await this.ams.getAmsUserById((request.auth.credentials as any).userId);
        if (!user) {
            throw boomBadRequest('Could not access user account');
        }

        return h.response(user).code(200);
    }

    @route({
        method: 'GET',
        path: '/api/v1/ams/account',
        options: {
            auth: {
                strategy: 'ams-session',
                mode: 'required',
                scope: ['api-client']
            },
            plugins: {
                'hapi-auth-cookie': {
                    redirectTo: false
                }
            },
            tags: ['ams'],
            description: 'Get logged in user AMS account registration'
        }
    })
    // @ts-ignore (h)
    public async getAmsAccountForUser(request: Request, h: ResponseToolkit) {
        this.server.log(['AmsRoutes', 'info'], 'getAmsAccountForUser');

        const accounts = await this.ams.getAmsAccountsForUser((request.auth.credentials as any).userId);
        if (!accounts) {
            throw boomUnauthorized('No credentials or AMS account could not be found');
        }

        return h.response(accounts).code(200);
    }

    @route({
        method: 'GET',
        path: '/api/v1/ams/account/{accountName}',
        options: {
            auth: {
                strategy: 'ams-session',
                mode: 'required',
                scope: ['api-client']
            },
            plugins: {
                'hapi-auth-cookie': {
                    redirectTo: false
                }
            },
            tags: ['ams'],
            description: 'Get logged in user AMS account registration'
        }
    })
    // @ts-ignore (h)
    public async getAmsAccountsForUser(request: Request, h: ResponseToolkit) {
        this.server.log(['AmsRoutes', 'info'], 'getAmsAccountsForUser');

        const accounts = await this.ams.getAmsAccountsForUser((request.auth.credentials as any).userId, request.params?.accountName);
        if (!accounts) {
            throw boomUnauthorized('No credentials or AMS account could not be found');
        }

        return h.response(accounts).code(200);
    }

    @route({
        method: 'POST',
        path: '/api/v1/ams/account',
        options: {
            auth: {
                strategy: 'ams-session',
                mode: 'required',
                scope: ['api-client']
            },
            plugins: {
                'hapi-auth-cookie': {
                    redirectTo: false
                }
            },
            tags: ['ams'],
            description: 'Update logged in user AMS account registration'
        }
    })
    public async postUpdateAmsAccountRegistration(request: Request, h: ResponseToolkit) {
        this.server.log(['AmsRoutes', 'info'], 'postUpdateAmsAccountRegistration');

        const amsAccount = (request.payload as any)?.amsAccount as IAmsAccount;
        if (!amsAccount) {
            throw boomUnauthorized('Missing amsAccount payload');
        }

        const updatedAccount = await this.ams.updateAmsAccountRegistration((request.auth.credentials as any).userId, amsAccount);
        if (!updatedAccount) {
            throw boomUnauthorized('No credentials or AMS account could not be found');
        }

        return h.response(updatedAccount).code(201);
    }

    @route({
        method: 'POST',
        path: '/api/v1/ams/streaminglocator',
        options: {
            auth: {
                strategy: 'ams-session',
                mode: 'required',
                scope: ['api-client']
            },
            plugins: {
                'hapi-auth-cookie': {
                    redirectTo: false
                }
            },
            tags: ['ams'],
            description: 'Create streaming locator'
        }
    })
    // @ts-ignore (h)
    public async postCreateAmsStreamingLocator(request: Request, h: ResponseToolkit) {
        this.server.log(['AmsRoutes', 'info'], 'postCreateAmsStreamingLocator');

        const accountName = (request.payload as any)?.accountName;
        const assetName = (request.payload as any)?.assetName;
        if (!assetName || !accountName) {
            throw boomBadRequest('Missing assetName or accountName parameters in payload');
        }

        const streamingLocatorResponse = await this.ams.postCreateAmsStreamingLocator((request.auth.credentials as any).userId, accountName, assetName);

        return h.response(streamingLocatorResponse).code((!streamingLocatorResponse || streamingLocatorResponse.length === 0) ? 401 : 201);
    }
}
