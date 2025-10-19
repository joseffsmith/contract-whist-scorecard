import "./index.css";

import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { CssVarsProvider, useColorScheme } from '@mui/joy/styles';
import CssBaseline from '@mui/joy/CssBaseline';

import { SnackbarProvider } from "notistack";
import { router } from "./Routes";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { theme } from "./theme/muiTheme";
import { useEffect } from "react";

// Component to sync MUI color scheme with our theme context
const ThemeSync: React.FC = () => {
  const { theme: currentTheme } = useTheme();
  const { setMode } = useColorScheme();
  
  useEffect(() => {
    setMode(currentTheme);
  }, [currentTheme, setMode]);
  
  return null;
};

// Component to handle MUI theme based on our theme context
const MuiThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <CssVarsProvider 
      theme={theme}
      modeStorageKey="mui-mode"
      disableTransitionOnChange={false}
    >
      <CssBaseline />
      <ThemeSync />
      {children}
    </CssVarsProvider>
  );
};

const container = document.getElementById("root");
const root = createRoot(container!);
root.render(
  <ThemeProvider>
    <MuiThemeProvider>
      <SnackbarProvider />
      <RouterProvider router={router} />
    </MuiThemeProvider>
  </ThemeProvider>
);
