type TelegramWebApp = {
  ready: () => void;
  expand: () => void;
  initData: string;
  initDataUnsafe: Record<string, unknown>;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function initializeTelegramWebApp(): boolean {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return false;

  webApp.ready();
  webApp.expand();
  document.documentElement.dataset.telegramWebApp = "true";
  return true;
}