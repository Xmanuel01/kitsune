"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

// Define the props interface with ALL props used in your layout
interface ThemeProviderProps {
  children: React.ReactNode;
  attribute?: "class" | "data-theme";
  defaultTheme?: string;
  enableSystem?: boolean;
  storageKey?: string;
  themes?: string[];
  forcedTheme?: string;
  disableTransitionOnChange?: boolean;
}

export function ThemeProvider({ 
  children, 
  attribute = "class",
  defaultTheme = "system",
  enableSystem = true,
  storageKey = "ui-theme",
  themes = ["light", "dark"],
  forcedTheme,
  disableTransitionOnChange = false,
  ...props 
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute={attribute}
      defaultTheme={defaultTheme}
      enableSystem={enableSystem}
      storageKey={storageKey}
      themes={themes}
      forcedTheme={forcedTheme}
      disableTransitionOnChange={disableTransitionOnChange}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}