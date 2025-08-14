import { useCallback, useEffect, useState } from 'react';
import useAsync from 'react-use/lib/useAsync';

import { useApi } from '@backstage/core-plugin-api';

import { learningPathApiRef } from '../api/LearningPathApiClient';
import { LearningPathLink } from '../types/types';

export const useLearningPathData = (): {
  data: LearningPathLink[] | undefined;
  error: Error | undefined;
  isLoading: boolean;
} => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [data, setData] = useState<LearningPathLink[]>();
  const [error, setError] = useState<Error>();
  const client = useApi(learningPathApiRef);
  const {
    value,
    error: apiError,
    loading,
  } = useAsync(() => {
    return client.getLearningPathData();
  });

  const fetchData = useCallback(async () => {
    const res = await fetch('/learning-paths/data.json');
    const qsData = await res.json();
    setData(qsData);
    setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (apiError) {
      setError(apiError);
      fetchData().catch(err => {
        setError(err);
        setIsLoading(false);
      });
    } else if (!loading && value) {
      setData(value);
      setIsLoading(false);
    }
  }, [apiError, fetchData, loading, setData, value]);

  return { data, error, isLoading };
};
