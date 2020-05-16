import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import { ConfigService } from './config';
import { CosmosDbContainer } from '../models/cosmosDbContainer';
import { CosmosClient, Database } from '@azure/cosmos';
import { DbAmsUser } from '../models/amsUser';
import { DbAmsAccount } from '../models/amsAccount';
import * as _assign from 'lodash.assign';

const amsContainerDefs = {
    ['amsUsers']: DbAmsUser,
    ['amsAccounts']: DbAmsAccount
};

@service('amsCosmosDb')
export class AmsCosmosDbService {
    @inject('$server')
    private server: Server;

    @inject('config')
    private config: ConfigService;

    private client: CosmosClient;
    private amsCosmosDb: Database;
    private amsCosmosDbContainers: { [key: string]: CosmosDbContainer };

    public get users() {
        return this.amsCosmosDbContainers.amsUsers;
    }

    public get accounts() {
        return this.amsCosmosDbContainers.amsAccounts;
    }

    public async init() {
        this.server.log(['AmsCosmosDb', 'info'], 'initialize');

        try {
            this.client = new CosmosClient({
                endpoint: this.config.get('docDbEndpoint'),
                key: this.config.get('docDbPrimaryKey')
            });

            const partitionKey = { kind: 'Hash', paths: ['/id'] };

            const { database } = await this.client.databases.createIfNotExists({ id: this.config.get('docDbDatabase') });
            this.amsCosmosDb = database;

            for (const containerId in amsContainerDefs) {
                if (!amsContainerDefs.hasOwnProperty(containerId)) {
                    continue;
                }

                const { container } = await this.amsCosmosDb.containers.createIfNotExists({ id: containerId, partitionKey }, { offerThroughput: 400 });
                const { resource: containerDef } = await container.read();
                const amsCosmosDbContainer = new amsContainerDefs[containerId](database, containerDef, this.server);

                this.amsCosmosDbContainers = {
                    ...this.amsCosmosDbContainers,
                    [containerId]: amsCosmosDbContainer
                };
            }
        }
        catch (ex) {
            this.server.log(['AmsCosmosDb', 'error'], `Error initializing LoopBox Cosmos Db: ${ex.message}`);
        }
    }
}
