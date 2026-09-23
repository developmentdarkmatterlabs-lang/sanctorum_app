import { useCallback, useEffect, useState } from 'react';
import { get } from '@/api/client';

type UseFetchResult<T> = {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};

export function useFetch<T>(url: string): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await get<T>(url));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    // Deferred so the first setState lands outside the effect body.
    const id = setTimeout(() => void fetchData(), 0);
    return () => clearTimeout(id);
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
