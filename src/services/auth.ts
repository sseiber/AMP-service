import { service, inject } from 'spryly';
import { Server, Request } from '@hapi/hapi';
import { ConfigService } from './config';
import { AmsService } from './ams';
import { sign as jwtSign } from 'jsonwebtoken';
import { v4 as uuidV4 } from 'uuid';
import * as _get from 'lodash.get';
import * as Wreck from '@hapi/wreck';
import getPem = require('rsa-pem-from-mod-exp');

@service('auth')
export class AuthService {
    @inject('$server')
    private server: Server;

    @inject('config')
    private config: ConfigService;

    @inject('ams')
    private ams: AmsService;

    private serviceAdminsInternal;
    private serviceSecretInternal;
    private serviceIssuerInternal;
    private azureB2CClientIdInternal;
    private azureB2CIssuerInternal;

    public get serviceAdmins() {
        return this.serviceAdminsInternal;
    }

    public get serviceSecret() {
        return this.serviceSecretInternal;
    }

    public get serviceIssuer() {
        return this.serviceIssuerInternal;
    }

    public get azureB2CClientId() {
        return this.azureB2CClientIdInternal;
    }

    public get azureB2CIssuer() {
        return this.azureB2CIssuerInternal;
    }

    public async init() {
        this.server.log(['AuthService', 'info'], 'initialize');

        this.serviceAdminsInternal = (this.config.get('serviceAdmins') || '').split(' ');

        this.serviceIssuerInternal = this.config.get('serverSystemId');
        if (!this.serviceIssuerInternal) {
            throw new Error('A service system id is required');
        }

        const secret = this.config.get('serverAuthSecret');
        if (!secret) {
            throw new Error('A service secret is required');
        }

        this.serviceSecretInternal = Buffer.from(secret, 'base64');

        this.azureB2CClientIdInternal = this.config.get('authAmsClientId');
        await this.getOpenIdMetadata();
    }

    public async providerSignin(request: Request, credentials: any): Promise<any> {
        this.server.log(['AuthService', 'info'], 'providerSignin');

        const profile = _get(credentials, 'profile');
        const authProvider = _get(request, 'auth.credentials.provider') || 'unknown';

        let user = await this.ams.getAmsUserByAuthProviderId(profile.id);
        if (!user) {
            user = await this.ams.createAmsUser(profile, authProvider);
        }

        const scope = user.amsAccounts.map(amsAccount => `user-${amsAccount.accountName}`);

        this.setSessionScope(request, user.id, scope);

        return user;
    }

    public setSessionScope(request: Request, userId: string, scope: string[]) {
        const profile = _get(request, 'auth.credentials.profile');
        scope.push('api-client');
        if (this.serviceAdmins.includes(profile.id)) {
            scope.push('admin');
        }

        (request as any).amsSessionAuth.set({
            userId,
            provider: _get(request, 'auth.credentials.provider') || 'unknown',
            accessToken: _get(request, 'auth.credentials.token') || '',
            profile: _get(request, 'auth.credentials.profile'),
            scope
        });
    }

    public getRedirectProtocol(request: Request): string {
        const referer = _get(request, 'headers.referer');
        if (!referer) {
            return _get(request, 'headers.x-forwarded-proto') || '';
        }

        if (referer.startsWith('https')) {
            return 'https';
        }

        return 'http';
    }

    public getRedirectHost(request: Request): string {
        return _get(request, 'headers.x-forwarded-host') || _get(request, 'headers.host') || '';
    }

    public async generateToken(scope: any): Promise<any> {
        const id = uuidV4();
        const arrayOfScope = Array.isArray(scope) ? scope : [scope];
        const payload = {
            id,
            // expiry: Date.now(), // TODO: implement expiry
            scope: arrayOfScope
        };

        const options = {
            issuer: this.serviceIssuerInternal
        };

        const token = await jwtSign(payload, this.serviceSecretInternal, options);

        return { token, id };
    }

    // @ts-ignore (id)
    public async revokeToken(id) {
        // TODO: implement
        return;
    }

    // The purpose of this function is to load the wellknown public keys that are used
    // to create the token signatures produced by the Azure AD B2C service. This includes
    // the id_token and access_token JWT tokens.
    // https://docs.microsoft.com/en-us/azure/active-directory-b2c/openid-connect#validate-the-id-token
    // https://www.voitanos.io/blog/validating-azure-ad-generated-oauth-tokens
    //
    // However, as of now (2020-03-02) there is a documented issue where the token is signed
    // before the service adds an additional 'nonce' field into the token thereby making it
    // impossible to verify the token using the public keys with the JTW signature because
    // the signature was created before the 'nonce' was added.
    //
    // Another verification method which is supported is verifying the 'at_hash'
    // (Access Token Hash) field of an accompanying id_token.
    // See section 3.1.3.8 in the OpenID Connect Core 1.0 spec
    // https://openid.net/specs/openid-connect-core-1_0.html
    // This is implemented in the verifyAccessTokenHash method (../plugins/auth.ts)
    //
    // For now this method is left here ready to use when the JWT tokens are fixed.
    private async getOpenIdMetadata() {
        const result = [];

        try {
            const openIdMetadataUrl = this.config.get('authAmsOpenIdConfigurationUrl').replace('###POLICY', this.config.get('authAmsSigninPolicy'));
            const openIdConfigResponse = await Wreck.get(openIdMetadataUrl, { json: true });
            this.azureB2CIssuerInternal = _get(openIdConfigResponse, 'payload.issuer');
            const jwksUri = _get(openIdConfigResponse, 'payload.jwks_uri');
            if (!jwksUri) {
                return result;
            }

            const jwksResponse = await Wreck.get(jwksUri, { json: true });
            const keys = _get(jwksResponse, 'payload.keys') || [];
            for (const key of keys) {
                const pemKey = getPem(key.n, key.e);
                result.push(pemKey);
            }
        }
        catch (ex) {
            this.server.log(['AuthService', 'error'], 'Failed while requesting Azure AD JWT keys');
        }

        return result;
    }
}
