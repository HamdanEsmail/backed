// The document every screen shares: the head (title, description, Switzer from Fontshare's own
// stylesheet, the site's sheet) and the footer. No inline script or style: the content-security-
// policy allows this origin and Fontshare's two hosts only, and every screen works without script.
import type { Child } from "hono/jsx";
import { createContext, useContext } from "hono/jsx";
import { raw } from "hono/html";

const FONTS = "https://api.fontshare.com/v2/css?f[]=switzer@400,500&display=swap";

/** The site's own address and the page's path, for the link-preview tags (which must be absolute).
 *  Set by the router for every page. */
export const PageContext = createContext<{ base: string; path: string }>({ base: "", path: "/" });

/** The link-preview card, 1200 by 630: the stage and the wordmark. */
const SOCIAL_IMAGE = "/assets/social.png";

/** Who built it, as a link to his GitHub: in the footer of every page and on How it works. */
export function Author() {
  return (
    <a href="https://github.com/HamdanEsmail" rel="author">
      Hamdan Esmail
    </a>
  );
}

export function Layout(props: { title: string; description: string; refreshSeconds?: number; noindex?: boolean; children: Child }) {
  const page = useContext(PageContext);
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
          <meta name="author" content="Hamdan Esmail" />
          <meta name="theme-color" content="#ff7a1f" />
          <meta property="og:type" content="website" />
          <meta property="og:site_name" content="Backed" />
          <meta property="og:title" content={props.title} />
          <meta property="og:description" content={props.description} />
          <meta property="og:url" content={page.base + page.path} />
          <meta property="og:image" content={page.base + SOCIAL_IMAGE} />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta property="og:image:alt" content="Backed: a founder's one line on a dark stage, and the word backed crossing onto the orange page." />
          <meta name="twitter:card" content="summary_large_image" />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
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
            <a href="/about">How it works</a>
          </li>
          <li>
            <a href="/score">The score</a>
          </li>
          <li>
            <a href="/searches">Saved searches</a>
          </li>
          <li>
            <a href="/api">API</a>
          </li>
        </ul>
        <div class="two">
          {props.saved === 1 ? (
            <p>One saved search is free to open, with every investor, every company and the proof.</p>
          ) : props.saved > 1 ? (
            <p>{props.saved} saved searches are free to open, each with every investor, every company and the proof.</p>
          ) : null}
          <p>Every list downloads as CSV and JSON, with the proof link and the quoted sentence in each row.</p>
        </div>
        <p class="legal">
          Built by <Author /> for the TinyFish Funding Radar bounty. Backed reads public funding announcements with TinyFish TinySet, Fetch, Search and
          Monitor. It is a starting list, not investment advice.
        </p>
      </div>
    </footer>
  );
}

/** The navigation at the top of the column. On the home, "How it works" and "The score" go to the
 *  home's own sections, which lead on to their pages; everywhere else they go to the pages. */
export function Nav(props: { home: boolean; className: string }) {
  return (
    <nav class={props.className} aria-label="Main">
      <a href={props.home ? "#the-list" : "/#the-list"} class="keep">
        The list
      </a>
      <a href={props.home ? "#how" : "/about"}>How it works</a>
      <a href={props.home ? "#score" : "/score"}>The score</a>
      <a href="/api">API</a>
      <a href={props.home ? "#try" : "/#line"} class="act">
        Try your startup
      </a>
    </nav>
  );
}
