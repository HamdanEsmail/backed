# Backed: the look

The reference is `design/comp-home.html` (pictures: `design/comp-first-screen.png`, `design/comp-desktop.jpg`,
`design/comp-phone.jpg`). Where this file and the comp disagree, the comp wins for the home and this file wins for
every other screen.

## The idea

The founder's own one line is the fixed half of the screen. Everything that scrolls past it is an answer to it.
The proof is always a sentence: the announcement's own words, with the investor's name highlighted in it. The name
of the product crosses from the dark stage onto the orange page, once, on the first screen. Every other page
opens the same way with its own word: proved, scored, served, stored.

## Colour

| Token | Value | Use |
|---|---|---|
| `--bg` | `#ff7a1f` | the page |
| `--surface` | `#ff8633` | a cell or panel one step off the page |
| `--ink` | `#050f16` | all text on orange and white, the stage, buttons, one full band |
| `--paper` | `#ffffff` | the first investor's sheet, the score sheet, the companies section, text on the stage |
| `--on-ink-muted` | `#a9b2b8` | secondary text on the stage |
| `--muted` | `#5a2306` | secondary text on orange, sparingly |
| grey on white | `#4a5257` text, `#f1efec` field | source lines and the sum field on a white sheet |

Three fields only: orange, blue-black, white. A section may change the whole field. Nothing fades into anything.
There are no status colours: a company is either proved or set apart, and the words say which.

## Type

One face: **Switzer**, weights 400 and 500, loaded from Fontshare's own stylesheet (`api.fontshare.com`), the way
Fontshare documents. The font files are not copied into this repository, because I could not confirm that its
licence allows redistributing them in a public repository. Five sizes and no others:

| Step | Size | Use |
|---|---|---|
| small | 13 to 14px | source lines, captions, navigation |
| body | 17 to 19px | running text, sums, buttons |
| lead | 20 to 26px | quotations, the supporting sentence, small headings |
| head | 32 to 64px | names of investors, the founder's line, figures, section headings |
| mark | 20.4vw | the wordmark, the one word that opens each other page, and the footer crop only |

Display sizes: tracking -0.03 to -0.045em, leading 1 to 1.1. Text: leading 1.45, tracking -0.01em. Tabular figures
wherever numbers line up. Every heading fits in two lines at every width; cut words before lowering the size.
A quotation is a `blockquote` at the lead size and runs to three lines; quote the clause that names the investor.

## Shape

Square corners everywhere. No lines, no outlines, no shadows, no gradients, no blur, no rounded pills. Surfaces are
told apart by a change of field colour or by space. One button shape: a flat filled rectangle. Margins are tight
(16 to 32px) and large things run to the edges.

## The pieces

- **The stage.** On wide screens the left 47% of the viewport, inset 20px, blue-black, `position: sticky` for the
  length of the split. It holds the form: a label, the line as a real `textarea` at the head size in white, two
  filled cells for stage and country, and one orange button the full width. At its foot, three figures with short
  captions; the first figure is orange. On a search's page the stage shows that search's line and its live state.
  On a phone the stage is the first block, not sticky.
- **The wordmark.** `backed`, lowercase, at the mark size along the foot of the first screen, starting over the
  stage's lower right corner and ending flush with the right margin. The part over the stage is orange, the rest is
  ink (a second copy clipped to the stage does this; see the comp).
- **The highlight.** Inside a quotation the investor's name is a `mark`: orange behind ink on white, blue-black
  behind orange on the orange field. It is the product's signature. Use it only on a name that the page really
  contains.
- **The first investor's sheet.** A white field the width of the column: the name at the head size with the score
  opposite it on the same baseline, one sentence saying why it is first, then each deal (a line of facts, the
  quotation, the source with its read date, the sum in a pale field), then "The way in" as a blue-black block.
- **The other investors.** Names at the head size with the score opposite, one line under each. Separated by space.
- **Two action cells.** Two filled rectangles side by side, 76px tall: blue-black with orange text, and `--surface`.
- **The score sheet.** A white sheet with scalloped top and bottom edges on a blue-black band; centred setting like
  a printed card; items on the left, points on the right, no leaders.
- **Plain names in columns.** Companies as text columns on white. A kind ("Proved by its announcement", "Set
  apart, not counted") is a first line in grey at the same size. A set-apart company carries its reason in small.
- **The figure tiles.** A two-thirds field beside two stacked tiles (blue-black and white), touching, no gaps.
- **The plain ask.** One sentence and one button on a nearly empty orange screen.
- **The footer.** Left half a blue-black crop with "led by whom?" at the mark size, cut by the edges; right half
  the menu at the head size, two short notes, and the legal line.

## The other pages

How it works, the score, the API and the saved searches are built from the same pieces, never from a plain
column of text.

- **The opening.** The stage holds the page's one line as its heading (no label above it), one orange button and
  three figures at its foot. Beside it, the supporting sentence and one word at the mark size that starts 6.4vw
  inside the stage, orange there and ink on the page, as the wordmark does on the home.
- **Something real.** Each page shows a piece of a stored search, not a description of one: a match followed
  from TinySet's row to the page's sentence to its points; one investor counted out and the first five added up;
  the first investor as the API answers it.
- **Names with a figure opposite.** The four TinyFish services with their calls, and the API's addresses, are set
  as the other investors are: the name at the head size, the figure on the same baseline, one line under it.
- **A closing field.** The rows the check set apart and the limits on white; the score sheet on blue-black.
- **The bands.** A saved search is one full-width band: its line at the head size (at the lead size on a phone,
  or when it runs past 80 characters), its figures under it. The bands take the three fields in turn.

## Voice

Plain and direct, spoken to a founder. Short sentences. It says what it found and what it could not find. It never
praises an investor and never ranks by fame. Words it uses: backed, led, joined, proved, set apart, the way in.
It does not say: verified, powered by, unlock, discover, seamless, insights.

## Motion

Parts of a section rise 24px with opacity as they enter, once. Buttons lift 2px on hover and press to 98%. The
wordmark shrinks a few percent as the first screen leaves. Everything is off under `prefers-reduced-motion`, and
nothing is hidden when a script or an animation does not run.

## Never

A second typeface. A sixth type size. Rounded corners. A line or an outline as a divider. A shadow. A gradient.
A status colour. A label above a heading. Monospace outside code. Numbered steps as 01, 02, 03. Cards in a row.
An investor's logo. A highlight on a name the page does not contain.
