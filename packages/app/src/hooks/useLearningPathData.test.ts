import { useApi } from '@backstage/core-plugin-api';

import { renderHook, waitFor } from '@testing-library/react';

import { useLearningPathData } from './useLearningPathData';

jest.mock('@backstage/core-plugin-api', () => ({
  ...jest.requireActual('@backstage/core-plugin-api'),
  useApi: jest.fn(),
}));

describe('useLearningPathData', () => {
  const learningPathData = [
    {
      paths: 6,
      minutes: 20,
      description:
        'Learn about k8s API fundamentals and the etcd operator, as well as how to use the Operator SDK with Go and Helm, review Ansible basics, and use Ansible to deploy Kubernetes modules.',
      label: 'Building Operators on OpenShift',
      url: 'https://developers.redhat.com/learn/openshift/operators',
    },
    {
      paths: 3,
      minutes: 20,
      description:
        'For the best experience in this learning path, we suggest that you complete the following learning resources in the order shown. When you click on a resource, it will open in a new tab. Keep this page open so you can easily move on to the next resource!',
      label: 'Configure a Jupyter notebook to use GPUs for AI/ML modeling',
      url: 'https://developers.redhat.com/learn/openshift-data-science/configure-jupyter-notebook-use-gpus-aiml-modeling',
    },
  ];
  beforeEach(() => {
    (useApi as jest.Mock).mockReturnValue({
      getLearningPathData: jest.fn(() => Promise.resolve(learningPathData)),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return learning path data', async () => {
    const { result } = renderHook(() => useLearningPathData());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
      expect(result.current.data).toStrictEqual(learningPathData);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeUndefined();
    });
  });

  it('handles API error properly', async () => {
    (useApi as jest.Mock).mockReturnValue({
      getHomeDataJson: jest.fn(() => Promise.reject(new Error('API Error'))),
      getLearningPathData: jest.fn(() =>
        Promise.reject(new Error('API Error')),
      ),
    });

    jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() =>
        Promise.reject(new Error('Fallback data fetch Error')),
      );

    const { result } = renderHook(() => useLearningPathData());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toEqual(
        new Error('Fallback data fetch Error'),
      );
    });
  });

  it('fetches learning page data from fallback if API fails', async () => {
    const learningPathDataFallback = [
      {
        paths: 1,
        minutes: 20,
        description:
          'For the best experience in this learning path, we suggest that you complete the following learning resources in the order shown. When you click on a resource, it will open in a new tab. Keep this page open so you can easily move on to the next resource!',
        label: 'Configure a Jupyter notebook to use GPUs for AI/ML modeling',
        url: 'https://developers.redhat.com/learn/openshift-data-science/configure-jupyter-notebook-use-gpus-aiml-modeling',
      },
    ];
    (useApi as jest.Mock).mockReturnValue({
      getHomeDataJson: jest.fn(() => Promise.reject(new Error('API Error'))),
      getLearningPathData: jest.fn(() =>
        Promise.reject(new Error('API Error')),
      ),
    });

    jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify(learningPathDataFallback))),
      );

    const { result } = renderHook(() => useLearningPathData());

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.data).toBeDefined();
      expect(result.current.data).toStrictEqual(learningPathDataFallback);
      expect(result.current.isLoading).toBe(false);
    });
  });
});
