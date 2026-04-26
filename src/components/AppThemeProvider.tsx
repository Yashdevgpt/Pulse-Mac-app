import type { ReactNode } from 'react';
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes';

type AppThemeProviderProps = ThemeProviderProps & {
  children: ReactNode;
};

export default function AppThemeProvider({ children, ...props }: AppThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
