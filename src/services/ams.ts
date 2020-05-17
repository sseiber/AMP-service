import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import { AmsCosmosDbService } from './amsCosmosDb';
import * as msRestNodeAuth from '@azure/ms-rest-nodeauth';
import { AzureMediaServices } from '@azure/arm-mediaservices';
import { v4 as uuidV4 } from 'uuid';
import * as LRUCache from 'lru-cache';

const CacheItemSize = (36 * 3) + (7 * 256);

interface IAmsClientResponse {
    amsClient: AzureMediaServices;
    amsResourceGroup: string;
    amsAccountName: string;
}

@service('ams')
export class AmsService {
    @inject('$server')
    private server: Server;

    @inject('amsCosmosDb')
    private amsCosmosDb: AmsCosmosDbService;

    private amsAccountCache: LRUCache<string, any>;

    public async init(): Promise<void> {
        this.server.log(['AmsService', 'info'], 'initialize');

        this.amsAccountCache = new LRUCache({
            max: CacheItemSize * 64,    // support 64 cached accounts
            maxAge: 1000 * 60 * 60 * 10 // age for max 10 hours
        });
    }

    public async updateAmsAccountRegistration(userId: string, amsAccount: any): Promise<any> {
        try {
            const user = await this.getAmsUserById(userId);
            if (!user) {
                this.server.log(['AmsService', 'info'], `No user found with userid: ${userId}`);

                throw new Error(`No user found with userid: ${userId}`);
            }

            const querySpec = {
                query: 'SELECT * FROM amsAccounts a WHERE a.iotcScopeId = @scopeId',
                parameters: [{
                    name: '@scopeId',
                    value: amsAccount.iotcScopeId
                }]
            };

            const account = await this.amsCosmosDb.accounts.getDocumentWithQuery(querySpec);

            amsAccount.id = account ? account.id : uuidV4();

            await this.amsCosmosDb.accounts.replaceDocument(amsAccount);

            if (!user.amsAccounts.includes(amsAccount.id)) {
                user.amsAccounts.push(amsAccount.id);

                await this.amsCosmosDb.users.replaceDocument(user);
            }
        }
        catch (ex) {
            this.server.log(['AmsService', 'error'], `An error occurred while updating the AMS account for scopeId: ${amsAccount.iotcScopeId}`);
        }

        return amsAccount;
    }

    public async getAmsAccountsForUser(userId: string, scopeId?: string): Promise<any[]> {
        const accounts = [];

        try {
            const user = await this.getAmsUserById(userId);
            if (!user) {
                this.server.log(['AmsService', 'info'], `No user found with userid: ${userId}`);

                throw new Error(`No user found with userid: ${userId}`);
            }

            for (const amsAccountId of user.amsAccounts) {
                const account = await this.amsCosmosDb.accounts.getDocumentById(amsAccountId);

                if (scopeId && amsAccountId === scopeId) {
                    return [account];
                }

                accounts.push(account);
            }
        }
        catch (ex) {
            this.server.log(['AmsService', 'error'], `An error occurred while accessing the account for scopeId: ${scopeId}`);
        }

        return accounts;
    }

    public async getAmsUserById(userId): Promise<any> {
        return this.amsCosmosDb.users.getDocumentById(userId);
    }

    public async getAmsUserByAuthProviderId(userId: string): Promise<any> {
        try {
            const querySpec = {
                query: 'SELECT * FROM amsUsers u WHERE u.authProviderId = @authProviderId',
                parameters: [{
                    name: '@authProviderId',
                    value: userId
                }]
            };

            return this.amsCosmosDb.users.getDocumentWithQuery(querySpec);
        }
        catch (ex) {
            this.server.log(['AmsService', 'error'], `An error occurred while accessing the user account`);
        }
    }

    public async createAmsUser(profile: any, authProvider: string): Promise<any> {
        return this.amsCosmosDb.users.createDocument({
            id: uuidV4(),
            authProviderId: profile.id,
            authProvider,
            displayName: profile.displayName,
            email: profile.email,
            amsAccounts: []
        });
    }

    // @ts-ignore (startTime)
    public async postCreateAmsStreamingLocator(userId: string, assetName: string, scopeId: string): Promise<any> {
        let createStreamingLocatorResponse = [];

        try {
            const amsClientResponse = await this.ensureAmsClient(userId, scopeId);
            if (!amsClientResponse) {
                return createStreamingLocatorResponse;
            }

            // const assetInfo = await amsClientResponse.amsClient.assets.get(this.amsResourceGroup, this.amsAccountName, assetName);
            // streamingLocatorResponse.assetStartTime = assetInfo.created;

            const listStreamingLocatorsResponse = await amsClientResponse.amsClient.assets.listStreamingLocators(amsClientResponse.amsResourceGroup, amsClientResponse.amsAccountName, assetName);
            if (listStreamingLocatorsResponse?.streamingLocators.length > 0) {
                createStreamingLocatorResponse = await this.getStreamingLocator(amsClientResponse, listStreamingLocatorsResponse.streamingLocators[0].name);
            }
            else {
                const streamingLocatorCreateParams = {
                    assetName,
                    streamingPolicyName: 'Predefined_ClearStreamingOnly'
                };
                const locatorName = `locator_${uuidV4()}`;

                const streamingLocatorsCreateResponse =
                    await amsClientResponse.amsClient.streamingLocators.create(amsClientResponse.amsResourceGroup, amsClientResponse.amsAccountName, locatorName, streamingLocatorCreateParams);
                if (streamingLocatorsCreateResponse) {
                    createStreamingLocatorResponse = await this.getStreamingLocator(amsClientResponse, streamingLocatorsCreateResponse.name);
                }
            }
        }
        catch (ex) {
            this.server.log(['AmsService', 'error'], `Error while creating streaming locator urls: ${ex.message}`);
        }

        return createStreamingLocatorResponse;
    }

    private async ensureAmsClient(userId: string, scopeId: string): Promise<IAmsClientResponse> {
        this.server.log(['AmsService', 'info'], 'initialize');

        try {
            let amsAccount = this.amsAccountCache.get(`${userId}:${scopeId}`);
            if (!amsAccount) {
                const amsAccounts = await this.getAmsAccountsForUser(userId, scopeId);
                amsAccount = amsAccounts.find(item => item.scopeId === scopeId);

                if (!amsAccount) {
                    return;
                }

                this.amsAccountCache.set(`${userId}:${scopeId}`, amsAccount);
            }

            const loginCredentials = await msRestNodeAuth.loginWithServicePrincipalSecret(
                amsAccount.amsAadClientId,
                amsAccount.amsAadSecret,
                amsAccount.amsAadTenantId, {
                environment: {
                    activeDirectoryResourceId: amsAccount.amsArmAadAudience,
                    resourceManagerEndpointUrl: amsAccount.amsArmEndpoint,
                    activeDirectoryEndpointUrl: amsAccount.amsAadEndpoint
                }
            });

            const amsClient = new AzureMediaServices(loginCredentials as any, amsAccount.amsSubscriptionId);

            return {
                amsClient,
                amsResourceGroup: amsAccount.amsResourceGroup,
                amsAccountName: amsAccount.amsAccountName
            };
        }
        catch (ex) {
            this.server.log(['AmsService', 'error'], `Error logging into AMS account: ${ex.message}`);
        }
    }

    private async getStreamingLocator(amsClientResponse: IAmsClientResponse, streamingLocatorName: string): Promise<any> {
        let streamingLocatorUrls = [];

        try {
            const streamingEndpoint = await amsClientResponse.amsClient.streamingEndpoints.get(amsClientResponse.amsResourceGroup, amsClientResponse.amsAccountName, 'default');

            const streamingLocatorsListPathsResponse =
                await amsClientResponse.amsClient.streamingLocators.listPaths(amsClientResponse.amsResourceGroup, amsClientResponse.amsAccountName, streamingLocatorName);

            streamingLocatorUrls = streamingLocatorsListPathsResponse.streamingPaths.map((streamingPath) => {
                return {
                    protocol: streamingPath.streamingProtocol,
                    streamingLocatorUrl: `https://${streamingEndpoint.hostName}/${streamingPath.paths[0]}`
                };
            });
        }
        catch (ex) {
            this.server.log(['AmsService', 'error'], `Error getting listing streaming locator paths: ${ex.message}`);
        }

        return streamingLocatorUrls;
    }
}