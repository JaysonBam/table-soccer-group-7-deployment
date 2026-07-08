const browserHost = typeof window === "undefined" || !window.location.host
  ? "localhost:5173"
  : window.location.host;
const browserHostname = typeof window === "undefined" || !window.location.hostname
  ? "localhost"
  : window.location.hostname;
const pageProtocol = typeof window === "undefined" ? "http:" : window.location.protocol;
const sameOriginWsProtocol = pageProtocol === "https:" ? "wss" : "ws";
const backendHttpProtocol = pageProtocol === "https:" ? "https" : "http";
const backendWsProtocol = pageProtocol === "https:" ? "wss" : "ws";
const configuredApiUrl = normalizeUrl(import.meta.env.VITE_API_URL);
const configuredWsUrl = normalizeUrl(import.meta.env.VITE_WS_URL);
const configuredFallbackApiUrl = normalizeUrl(import.meta.env.VITE_FALLBACK_API_URL);
const configuredFallbackWsUrl = normalizeUrl(import.meta.env.VITE_FALLBACK_WS_URL);
const isLocalBrowser = browserHostname === "localhost"
  || browserHostname === "127.0.0.1"
  || browserHostname === "::1";

export const API_URL = configuredApiUrl ?? "";
export const WS_URL = configuredWsUrl
  ?? (configuredApiUrl ? toWebSocketUrl(configuredApiUrl) : `${sameOriginWsProtocol}://${browserHost}`);
export const FALLBACK_API_URL = configuredFallbackApiUrl
  ?? (isLocalBrowser ? `${backendHttpProtocol}://${browserHostname}:3000` : "");
export const FALLBACK_WS_URL = configuredFallbackWsUrl
  ?? (isLocalBrowser ? `${backendWsProtocol}://${browserHostname}:3000` : "");

function normalizeUrl(value: string | undefined): string | null {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  return trimmedValue.replace(/\/+$/, "");
}

function toWebSocketUrl(httpUrl: string): string {
  if (httpUrl.startsWith("https://")) {
    return `wss://${httpUrl.slice("https://".length)}`;
  }

  if (httpUrl.startsWith("http://")) {
    return `ws://${httpUrl.slice("http://".length)}`;
  }

  return httpUrl;
}
