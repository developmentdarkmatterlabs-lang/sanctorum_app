import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { AppSettingsProvider } from "@/contexts/AppSettingsContext";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AppSettingsProvider>
      <Component {...pageProps} />
    </AppSettingsProvider>
  );
}
