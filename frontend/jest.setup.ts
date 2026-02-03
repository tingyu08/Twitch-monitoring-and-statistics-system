import React from "react";
import "@testing-library/jest-dom";

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

if (!global.fetch) {
  global.fetch = jest.fn();
}

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("next-intl/server", () => ({
  getRequestConfig: jest.fn(),
  getTranslations: jest.fn(),
  getLocale: jest.fn(),
  getMessages: jest.fn(),
  getTimeZone: jest.fn(),
  getFormatter: jest.fn(),
  getNow: jest.fn(),
  setRequestLocale: jest.fn(),
}));
