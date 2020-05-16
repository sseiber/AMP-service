import { Server } from '@hapi/hapi';
import { Database } from '@azure/cosmos';
import { CosmosDbContainer } from './cosmosDbContainer';
import { extract } from '../utils';

export interface IAmsUser {
    id: string;
    provider: string;
    displayName: string;
    email: string;
    amsAccounts: string[];
}

export class DbAmsUser extends CosmosDbContainer {
    public static extractAmsUser = extract<IAmsUser>({
        id: true,
        provider: true,
        displayName: true,
        email: true,
        amsAccounts: true
    });

    constructor(cosmosDb: Database, containerDef: any, server: Server) {
        super(cosmosDb, containerDef, server);
    }
}
