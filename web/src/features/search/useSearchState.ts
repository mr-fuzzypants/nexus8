import { useCallback, useMemo } from 'react';
import { useLocation, useSearch } from 'wouter';

export interface SearchState {
  q: string;
  tags: string[];
  mediaType: string;
}

/**
 * Search state lives entirely in the URL (?q=&tag=&tag=&media_type=) so every
 * result set is shareable and survives reloads. Project scope comes from the
 * /p/:code route (see useProject), not the query string. Navigation is
 * relative, so under the nested workspace router it stays within the project.
 */
export function useSearchState() {
  const search = useSearch();
  const [, navigate] = useLocation();

  const state: SearchState = useMemo(() => {
    const params = new URLSearchParams(search);
    return {
      q: params.get('q') ?? '',
      tags: params.getAll('tag'),
      mediaType: params.get('media_type') ?? '',
    };
  }, [search]);

  const update = useCallback(
    (patch: Partial<SearchState>) => {
      const next = { ...state, ...patch };
      const params = new URLSearchParams();
      if (next.q) params.set('q', next.q);
      for (const tag of next.tags) params.append('tag', tag);
      if (next.mediaType) params.set('media_type', next.mediaType);
      const qs = params.toString();
      navigate(qs ? `/?${qs}` : '/', { replace: true });
    },
    [state, navigate],
  );

  const toggleTag = useCallback(
    (tag: string) => {
      update({
        tags: state.tags.includes(tag)
          ? state.tags.filter((t) => t !== tag)
          : [...state.tags, tag],
      });
    },
    [state.tags, update],
  );

  return { state, update, toggleTag };
}
