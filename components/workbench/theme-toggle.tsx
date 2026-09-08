'use client';
import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { getTheme, setTheme, subscribeTheme, type WorkbenchTheme } from '@/lib/workbench/theme';

const serverTheme = (): WorkbenchTheme => 'dark';
export function useWorkbenchTheme() {
  return useSyncExternalStore(subscribeTheme, getTheme, serverTheme);
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useWorkbenchTheme();
  const label = theme === 'dark' ? '切换到浅色模式' : '切换到深色模式';
  return <button type="button" className="wb-theme-toggle" aria-label={label} title={label}
    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
    {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    {!compact && <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>}
  </button>;
}
