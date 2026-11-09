export interface Env {
  DB: D1Database;
  TINYFISH_API_KEY: string;
  ADMIN_TOKEN: string;
  WEBHOOK_SECRET: string;
  PUBLIC_BASE_URL: string;
  /** "1" turns the site's screens on; anything else leaves every site path answering 404. */
  SITE_ENABLED?: string;
}
