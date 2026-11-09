// The document every screen shares: the head (title, description, Switzer from Fontshare's own
// stylesheet, the site's sheet) and the footer. No inline script or style: the content-security-
// policy allows this origin and Fontshare's two hosts only, and every screen works without script.
import type { Child } from "hono/jsx";
import { raw } from "hono/html";

const FONTS = "https://api.fontshare.com/v2/css?f[]=switzer@400,500&display=swap";

export function Layout(props: { title: string; description: string; refreshSeconds?: number; noindex?: boolean; children: Child }) {
  return (
    <>
      {raw("<!doctype html>")}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          {props.refreshSeconds !== undefined ? <meta http-equiv="refresh" content={String(props.refreshSeconds)} /> : null}
          {props.noindex ? <meta name="robots" content="noindex" /> : null}
          <title>{props.title}</title>
          <meta name="description" content={props.description} />
          <meta name="theme-color" content="#ff7a1f" />
          <link rel="preconnect" href="https://api.fontshare.com" />
          <link rel="preconnect" href="https://cdn.fontshare.com" crossorigin="anonymous" />
          <link rel="stylesheet" href={FONTS} />
          <link rel="stylesheet" href="/assets/site.css" />
        </head>
        <body>
          <main>{props.children}</main>
        </body>
      </html>
    </>
  );
}

/** The footer: a crop of "led by whom?" beside the menu, two notes and the legal line. */
export function Footer(props: { saved: number }) {
  return (
    <footer class="foot">
      <div class="crop" aria-hidden="true">
        <p>
          led by <mark>whom?</mark>
        </p>
      </div>
      <div class="menu">
        <p class="name">Backed</p>
        <ul>
          <li>
            <a href="/#the-list">The list</a>
          </li>
          <li>
            <a href="/#how">How it works</a>
          </li>
          <li>
            <a href="/#score">The score</a>
          </li>
          <li>
            <a href="/searches">Saved searches</a>
          </li>
          <li>
            <a href="/api">API</a>
          </li>
        </ul>
        <div class="two">
          <p>
            {props.saved > 0
              ? `${props.saved === 1 ? "One saved search is" : `${props.saved} saved searches are`} free to open, each with every investor, every company and the proof.`
              : "Saved searches are free to open, each with every investor, every company and the proof."}
          </p>
          <p>Every list downloads as CSV and JSON, with the proof link and the quoted sentence in each row.</p>
        </div>
        <p class="legal">
          Built by Hamdan Esmail for the TinyFish Funding Radar bounty. Backed reads public funding announcements with TinyFish TinySet, Fetch and Search. It
          is a starting list, not investment advice.
        </p>
      </div>
    </footer>
  );
}

/** The navigation at the top of the column. `here` is the page's own address for the first link. */
export function Nav(props: { home: boolean; className: string }) {
  const at = (hash: string) => (props.home ? hash : `/${hash}`);
  return (
    <nav class={props.className} aria-label="Main">
      <a href={at("#the-list")} class="keep">
        The list
      </a>
      <a href={at("#how")}>How it works</a>
      <a href={at("#score")}>The score</a>
      <a href="/api">API</a>
      <a href={props.home ? "#try" : "/#line"} class="act">
        Try your startup
      </a>
    </nav>
  );
}
