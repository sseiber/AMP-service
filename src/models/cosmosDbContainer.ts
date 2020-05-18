import { Server } from '@hapi/hapi';
import { Database, SqlQuerySpec } from '@azure/cosmos';
import * as _get from 'lodash.get';

export class QueryHelpers {
    public static createIdQuery(id: string): SqlQuerySpec {
        return {
            query: 'SELECT * FROM docs WHERE docs.id=@id',
            parameters: [{
                name: '@id',
                value: id
            }]
        };
    }

    public static createFilteredQuery(filter: any): SqlQuerySpec {
        return {
            query: `SELECT * from docs WHERE CONTAINS(docs.${filter.column}, @filter)`,
            parameters: [{
                name: '@filter',
                value: filter.filter
            }]
        };
    }

    public static createQueryAllQuery(): SqlQuerySpec {
        return {
            query: 'SELECT * FROM docs',
            parameters: []
        };
    }
}

export class CosmosDbContainer {
    private cosmosDb: Database;
    private containerDef: any;
    private server: Server;

    constructor(cosmosDb: Database, containerDef: any, server: Server) {
        this.cosmosDb = cosmosDb;
        this.containerDef = containerDef;
        this.server = server;
    }

    public get id(): string {
        return this.containerDef.id;
    }

    public get self(): string {
        return '';
    }

    public async getDocumentById(id: string): Promise<any> {
        let result;

        try {
            const { resources } = await this.cosmosDb.container(this.id).items.query(QueryHelpers.createIdQuery(id)).fetchAll();
            result = _get(resources, '0');
        }
        catch (ex) {
            this.server.log(['CosmosDbContainer', 'error'], `getDocumentById: ${ex.message}`);
        }

        return result;
    }

    public async getDocumentWithQuery(querySpec: SqlQuerySpec): Promise<any> {
        let result;

        try {
            const { resources } = await this.cosmosDb.container(this.id).items.query(querySpec).fetchAll();
            result = _get(resources, '0');
        }
        catch (ex) {
            this.server.log(['CosmosDbContainer', 'error'], `getDocumentWithQuery: ${ex.message}`);
        }

        return result;
    }

    public async createDocument(itemBody: any): Promise<any> {
        let result;

        try {
            const { resource } = await this.cosmosDb.container(this.id).items.upsert(itemBody);
            result = resource;
        }
        catch (ex) {
            this.server.log(['CosmosDbContainer', 'error'], `createDocument: ${ex.message}`);
        }

        return result;
    }

    public async replaceDocument(itemBody: any): Promise<any> {
        let result;

        try {
            const { resource } = await this.cosmosDb.container(this.id).items.upsert(itemBody);
            result = resource;
        }
        catch (ex) {
            this.server.log(['CosmosDbContainer', 'error'], `replaceDocument: ${ex.message}`);
        }

        return result;
    }

    public async deleteDocument(id: string): Promise<any> {
        try {
            await this.cosmosDb.container(this.id).item(id, undefined).delete();
        }
        catch (ex) {
            this.server.log(['CosmosDbContainer', 'error'], `createDocument: ${ex.message}`);
        }
    }
}
