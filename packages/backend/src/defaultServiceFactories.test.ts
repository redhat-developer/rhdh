import { ServiceFactory } from '@backstage/backend-plugin-api';

import { DEFAULT_SERVICE_FACTORIES } from './defaultServiceFactories';

// explicitly check this against the module inside the installed package
const {
  defaultServiceFactories: upstreamDefaultServiceFactories,
  // eslint-disable-next-line
} = require('../../../node_modules/@backstage/backend-defaults/dist/CreateBackend.cjs.js');

function findDifference(a1: string[], a2: string[]) {
  const set = new Set(a2);
  return a1.filter(i => !set.has(i));
}

function findSymmetricDifference(a1: string[], a2: string[]) {
  return [...new Set([...findDifference(a1, a2), ...findDifference(a2, a1)])];
}

/**
 * Validate that the installed backend-defaults package contains the expected
 * list of default service factories.  A failure in this test indicates that
 * either the export was removed, the list was moved, or the list in
 * "defaultServiceFactories" should be updated.
 */
describe('Default service factory list comparison', () => {
  it('Should produce an expected difference of service factories as compared to the upstream implementation', () => {
    const upstreamServiceFactoryIds = upstreamDefaultServiceFactories.map(
      (serviceFactory: ServiceFactory) => serviceFactory.service.id,
    );
    const serviceFactoryIds = DEFAULT_SERVICE_FACTORIES.map(
      (serviceFactory: ServiceFactory) => serviceFactory.service.id,
    );
    expect(
      findSymmetricDifference(upstreamServiceFactoryIds, serviceFactoryIds),
    ).toEqual([]);
  });
});
