import { AmsCosmosDbService } from '../../services/amsCosmosDb';

it('should be constructed', () => {
    const testInstance = new AmsCosmosDbService();
    expect(testInstance).toBeDefined();
});
