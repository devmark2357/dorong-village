/** Meta App Events bridge. activateApp is called natively on launch; nothing to do from JS for installs/app opens. */
export interface FbEventsPlugin {
  /** Custom or standard event, e.g. name: 'fb_mobile_level_achieved', params: { fb_level: '1장' }. */
  logEvent(options: { name: string; params?: Record<string, string | number | boolean> }): Promise<void>;
  /** Purchase (fb_mobile_purchase). amount in major units (e.g. 3300 for KRW, 2.99 for USD), currency ISO 4217 (e.g. 'KRW'). */
  logPurchase(options: { amount: number; currency: string; params?: Record<string, string | number | boolean> }): Promise<void>;
}
