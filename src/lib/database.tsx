import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { migrateArticles } from '@/lib/articles';

type DatabaseState = {
  db: SQLiteDatabase | null;
  error: Error | null;
};

const DatabaseContext = createContext<DatabaseState>({ db: null, error: null });

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DatabaseState>({ db: null, error: null });

  useEffect(() => {
    let cancelled = false;
    openDatabaseAsync('digestlocal.db')
      .then(async (db) => {
        await migrateArticles(db);
        if (!cancelled) setState({ db, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          db: null,
          error: error instanceof Error ? error : new Error('The local database did not open.'),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <DatabaseContext.Provider value={state}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): DatabaseState {
  return useContext(DatabaseContext);
}
