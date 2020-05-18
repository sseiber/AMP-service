import { Server } from '@hapi/hapi';
import { Database } from '@azure/cosmos';
import { CosmosDbContainer } from './cosmosDbContainer';
import { extract } from '../utils';

export interface IAmsAccount {
    id: string;
    amsAadClientId: string;
    amsAadSecret: string;
    amsAadTenantId: string;
    amsAccountName: string;
    amsRegion: string;
    amsResourceGroup: string;
    amsSubscriptionId: string;
    amsArmAadAudience: string;
    amsArmEndpoint: string;
    amsAadEndpoint: string;
}

export class DbAmsAccount extends CosmosDbContainer {
    public static extractAmsAccount = extract<IAmsAccount>({
        id: true,
        amsAadClientId: true,
        amsAadSecret: true,
        amsAadTenantId: true,
        amsAccountName: true,
        amsRegion: true,
        amsResourceGroup: true,
        amsSubscriptionId: true,
        amsArmAadAudience: true,
        amsArmEndpoint: true,
        amsAadEndpoint: true
    });

    constructor(cosmosDb: Database, containerDef: any, server: Server) {
        super(cosmosDb, containerDef, server);
    }
}
