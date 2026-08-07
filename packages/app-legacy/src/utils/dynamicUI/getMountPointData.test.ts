/*
 * Layer 3 component test mirroring part of the behavior exercised by the UI
 * E2E spec header-mount-points (net new — the E2E spec is left in place).
 * Covers how header/mount-point data is resolved from the Scalprum dynamic
 * root config that the header components consume.
 */
import { getScalprum } from '@scalprum/core';

import getMountPointData from './getMountPointData';

jest.mock('@scalprum/core', () => ({ getScalprum: jest.fn() }));

const mockGetScalprum = getScalprum as jest.Mock;

const scalprumWithMountPoints = (
  mountPoints: Record<string, unknown[]> | undefined,
) => ({
  api: { dynamicRootConfig: mountPoints ? { mountPoints } : undefined },
});

describe('getMountPointData', () => {
  afterEach(() => jest.resetAllMocks());

  it('returns the entries configured for the requested mount point', () => {
    const entry = {
      config: { layout: {} },
      Component: () => null,
      staticJSXContent: null,
    };
    mockGetScalprum.mockReturnValue(
      scalprumWithMountPoints({ 'application/header': [entry] }),
    );

    expect(getMountPointData('application/header')).toEqual([entry]);
  });

  it('returns an empty array when the mount point is not configured', () => {
    mockGetScalprum.mockReturnValue(scalprumWithMountPoints({}));

    expect(getMountPointData('application/header')).toEqual([]);
  });

  it('returns an empty array when no dynamic root config is present', () => {
    mockGetScalprum.mockReturnValue(scalprumWithMountPoints(undefined));

    expect(getMountPointData('application/header')).toEqual([]);
  });
});
