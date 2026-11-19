/** Google Play Install Referrer. Android only. */
export interface InstallReferrerPlugin {
  /** referrer = raw referrer string (e.g. "utm_source=google-play&utm_medium=organic"). Rejects if Play Store is unavailable. */
  get(): Promise<{ referrer: string; clickTs: number; installTs: number }>;
}
