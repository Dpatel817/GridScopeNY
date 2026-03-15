import { useState, useEffect, useCallback, useRef } from 'react';

const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000;

interface RefreshState {
  refreshing: boolean;
  lastRefresh: Date | null;
  error: string | null;
  autoRefreshEnabled: boolean;
}

let globalListeners: (() => void)[] = [];

function notifyListeners() {
  globalListeners.forEach(fn => fn());
}

export function onDataRefreshed(fn: () => void) {
  globalListeners.push(fn);
  return () => {
    globalListeners = globalListeners.filter(l => l !== fn);
  };
}

export function useDataRefresh() {
  const [state, setState] = useState<RefreshState>({
    refreshing: false,
    lastRefresh: null,
    error: null,
    autoRefreshEnabled: true,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (state.refreshing) return;
    setState(s => ({ ...s, refreshing: true, error: null }));
    try {
      const res = await fetch('/api/cache/clear', { method: 'POST' });
      if (!res.ok) throw new Error('Cache clear failed');
      setState(s => ({
        ...s,
        refreshing: false,
        lastRefresh: new Date(),
        error: null,
      }));
      notifyListeners();
    } catch (e: any) {
      setState(s => ({
        ...s,
        refreshing: false,
        error: e.message || 'Refresh failed',
      }));
    }
  }, [state.refreshing]);

  const fullRefresh = useCallback(async () => {
    if (state.refreshing) return;
    setState(s => ({ ...s, refreshing: true, error: null }));
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const data = await res.json();
      if (data.status === 'already_running') {
        setState(s => ({ ...s, refreshing: false, error: null }));
        return;
      }
      if (!res.ok || data.status === 'timeout') {
        throw new Error(data.message || 'Refresh failed');
      }
      setState(s => ({
        ...s,
        refreshing: false,
        lastRefresh: new Date(),
        error: data.status === 'partial' ? 'Partial refresh — some datasets may not have updated' : null,
      }));
      notifyListeners();
    } catch (e: any) {
      setState(s => ({
        ...s,
        refreshing: false,
        error: e.message || 'Refresh failed',
      }));
    }
  }, [state.refreshing]);

  const toggleAutoRefresh = useCallback(() => {
    setState(s => ({ ...s, autoRefreshEnabled: !s.autoRefreshEnabled }));
  }, []);

  useEffect(() => {
    if (state.autoRefreshEnabled) {
      intervalRef.current = setInterval(() => {
        fullRefresh();
      }, AUTO_REFRESH_INTERVAL);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state.autoRefreshEnabled, fullRefresh]);

  return {
    ...state,
    refresh,
    fullRefresh,
    toggleAutoRefresh,
  };
}
