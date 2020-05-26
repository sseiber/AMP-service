import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import { AmsCosmosDbService } from './amsCosmosDb';
import { IAmsAccount } from '../models/amsAccount';
import * as msRestNodeAuth from '@azure/ms-rest-nodeauth';
import { AzureMediaServices } from '@azure/arm-mediaservices';
import { v4 as uuidV4 } from 'uuid';
import * as LRUCache from 'lru-cache';

const CacheItemSize = (36 * 3) + (7 * 256);

interface IAmsRequestParams {
    amsClient: AzureMediaServices;
    accountName: string;
    resourceGroup: string;
    assetName: string;
}

export interface IAmsResponse {
    statusMessage: string;
    data: any;
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

    public async updateAmsAccountRegistration(userId: string, amsAccount: IAmsAccount): Promise<IAmsAccount[]> {
        let accounts = [];

        try {
            const user = await this.getAmsUserById(userId);
            if (!user) {
                this.server.log(['AmsService', 'info'], `No user found with userid: ${userId}`);

                throw new Error(`No user found with userid: ${userId}`);
            }

            if (amsAccount.id) {
                await this.amsCosmosDb.accounts.replaceDocument(amsAccount);
            }
            else {
                amsAccount.id = uuidV4();
                await this.amsCosmosDb.accounts.createDocument(amsAccount);
            }

            if (!user.amsAccounts.includes(amsAccount.id)) {
                user.amsAccounts.push(amsAccount.id);

                await this.amsCosmosDb.users.replaceDocument(user);
            }

            this.amsAccountCache.set(`${userId}:${amsAccount.amsAccountName}`, amsAccount);

            accounts = await this.getAmsAccountsForUser(userId);
        }
        catch (ex) {
            this.server.log(['AmsService', 'error'], `An error occurred while updating the AMS account for accountName: ${amsAccount.amsAccountName}`);
        }

        return accounts;
    }

    public async deleteAmsAccountRegistration(userId: string, amsAccountId: string): Promise<boolean> {
        let result = false;

        try {
            const user = await this.getAmsUserById(userId);
            if (!user) {
                this.server.log(['AmsService', 'info'], `No user found with userid: ${userId}`);

                throw new Error(`No user found with userid: ${userId}`);
            }

            const amsAccount = await this.amsCosmosDb.accounts.getDocumentById(amsAccountId);
            await this.amsCosmosDb.accounts.deleteDocument(amsAccountId);
            this.amsAccountCache.del(`${userId}:${amsAccount.amsAccountName}`);

            const amsAccountIndex = user.amsAccounts.indexOf(amsAccountId);
            if (amsAccountIndex >= 0) {
                user.amsAccounts.splice(amsAccountIndex, 1);

                await this.amsCosmosDb.users.replaceDocument(user);
            }

            result = true;
        }
        catch (ex) {
            this.server.log(['AmsService', 'error'], `An error occurred while deleting the AMS account`);
        }

        return result;
    }

    public async getAmsAccountsForUser(userId: string, accountName?: string): Promise<IAmsAccount[]> {
        const accounts = [];

        try {
            const user = await this.getAmsUserById(userId);
            if (!user) {
                this.server.log(['AmsService', 'info'], `No user found with userid: ${userId}`);

                throw new Error(`No user found with userid: ${userId}`);
            }

            for (const amsAccountId of user.amsAccounts) {
                const account = await this.amsCosmosDb.accounts.getDocumentById(amsAccountId);

                if (accountName && account.accountName === accountName) {
                    return [account];
                }

                accounts.push(account);
            }
        }
        catch (ex) {
            this.server.log(['AmsService', 'error'], `An error occurred while accessing the account for accountName: ${accountName || '[all accounts]'}`);
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
    public async postCreateAmsStreamingLocator(userId: string, accountName: string, assetName: string): Promise<IAmsResponse> {
        let amsResponse = {
            statusMessage: 'SUCCESS',
            data: undefined
        };

        try {
            amsResponse = await this.ensureAmsClient(userId, accountName);
            if (amsResponse.statusMessage !== 'SUCCESS') {
                return amsResponse;
            }

            const amsRequestParams: IAmsRequestParams = {
                amsClient: amsResponse.data.amsClient,
                accountName: amsResponse.data.accountName,
                resourceGroup: amsResponse.data.resourceGroup,
                assetName
            };

            amsResponse = await this.listStreamingLocators(amsRequestParams);
            if (amsResponse.statusMessage !== 'SUCCESS') {
                return amsResponse;
            }

            if (amsResponse.data?.streamingLocators.length > 0) {
                amsResponse = await this.getStreamingLocator(amsRequestParams, amsResponse.data.streamingLocators[0].name);
            }
            else {
                amsResponse = await this.createStreamingLocators(amsRequestParams);
                if (amsResponse.statusMessage !== 'SUCCESS') {
                    return amsResponse;
                }

                amsResponse = await this.getStreamingLocator(amsRequestParams, amsResponse.data.name);
            }
        }
        catch (ex) {
            this.server.log(['AmsService', 'error'], `Error while creating streaming locator: ${ex.message}`);
            amsResponse.statusMessage = 'ERROR_UNKNOWN';
        }

        return amsResponse;
    }

    private async ensureAmsClient(userId: string, accountName: string): Promise<IAmsResponse> {
        this.server.log(['AmsService', 'info'], 'initialize');

        const amsResponse = {
            statusMessage: 'SUCCESS',
            data: {}
        };

        try {
            let amsAccount = this.amsAccountCache.get(`${userId}:${accountName}`);
            if (!amsAccount) {
                const amsAccounts = await this.getAmsAccountsForUser(userId, accountName);
                amsAccount = amsAccounts.find(item => item.amsAccountName === accountName);

                if (!amsAccount) {
                    amsResponse.statusMessage = 'ERROR_NO_AMS_ACCOUNT';
                    return amsResponse;
                }

                this.amsAccountCache.set(`${userId}:${accountName}`, amsAccount);
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

            amsResponse.data = {
                amsClient,
                resourceGroup: amsAccount.amsResourceGroup,
                accountName: amsAccount.amsAccountName
            };
        }
        catch (ex) {
            this.server.log(['AmsService', 'error'], `Error logging into AMS account: ${ex.message}`);

            amsResponse.statusMessage = 'ERROR_UNKNOWN';
        }

        return amsResponse;
    }

    private async getStreamingLocator(amsRequestParams: IAmsRequestParams, streamingLocatorName: string): Promise<IAmsResponse> {
        const response: IAmsResponse = {
            statusMessage: 'SUCCESS',
            data: []
        };

        try {
            const streamingEndpoint = await amsRequestParams.amsClient.streamingEndpoints.get(
                amsRequestParams.resourceGroup,
                amsRequestParams.accountName,
                'default');

            const streamingLocatorsListPathsResponse =
                await amsRequestParams.amsClient.streamingLocators.listPaths(
                    amsRequestParams.resourceGroup,
                    amsRequestParams.accountName,
                    streamingLocatorName);

            response.data = streamingLocatorsListPathsResponse.streamingPaths.map((streamingPath) => {
                return {
                    protocol: streamingPath.streamingProtocol,
                    streamingLocatorUrl: `https://${streamingEndpoint.hostName}/${streamingPath.paths[0]}`
                };
            });
        }
        catch (ex) {
            this.server.log(['AmsService', 'error'], `Error getting listing streaming locator paths: ${ex.message}`);
            response.statusMessage = 'ERROR_ACCESSING_STREAMING_LOCATOR';
        }

        return response;
    }

    private async listStreamingLocators(amsRequestParams: IAmsRequestParams): Promise<IAmsResponse> {
        const response: IAmsResponse = {
            statusMessage: 'SUCCESS',
            data: {}
        };

        try {
            response.data = await amsRequestParams.amsClient.assets.listStreamingLocators(
                amsRequestParams.resourceGroup,
                amsRequestParams.accountName,
                amsRequestParams.assetName);
        }
        catch (ex) {
            this.server.log(['AmsService', 'error'], `The specified asset (${amsRequestParams.assetName}) was not found: ${ex.message}`);
            response.statusMessage = 'ERROR_ASSET_NOT_FOUND';
        }

        return response;
    }

    private async createStreamingLocators(amsRequestParams: IAmsRequestParams): Promise<IAmsResponse> {
        const response: IAmsResponse = {
            statusMessage: 'SUCCESS',
            data: []
        };

        try {
            response.data = await amsRequestParams.amsClient.streamingLocators.create(
                amsRequestParams.resourceGroup,
                amsRequestParams.accountName,
                `locator_${uuidV4()}`,
                {
                    assetName: amsRequestParams.assetName,
                    streamingPolicyName: 'Predefined_ClearStreamingOnly'
                });
        }
        catch (ex) {
            this.server.log(['AmsService', 'error'], `Error while creating streaming locator urls: ${ex.message}`);
            response.statusMessage = 'ERROR_STREAMING_LOCATOR';
        }

        return response;
    }
}
