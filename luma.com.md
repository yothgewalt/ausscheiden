# Design Map

## Spacing Scale
- Base unit: 4px
- Values: 4px (25×), 8px (38× — dominant), 16px (13×), 18px (paragraph beat, 28× — off-grid), 24px
- Negative: -4px / -8px (avatar overlap)
- Method: flexbox `gap` + `margin` (no CSS grid; `gridCount: 0`)

## Font Hierarchy
- h1 — 48px / weight 575 / line-height 55.2px / `Google Sans Flex`
- body — 16px / 400 / 24px line-height / `-apple-system` (45× — dominant)
- ui — 14px / 500 / `-apple-system` (20×)
- meta — 13px / 400 / `-apple-system`
- caption — 12px / 400 / `-apple-system`

## Color Palette
- background — `#F2F2F2` (92.9% of visible surface)
- surface — `#FFFFFF` (cards)
- text-primary — `#141414`
- text-muted — `rgba(20,20,20,0.64)` / subtle `rgba(20,20,20,0.36)`
- accent — `#D69712` (amber, 3× uses, <1% area, "Require Approval" badges only)

## Image Ratios
- cover — 330×330, **1:1**, radius 24px, no shadow
- registration card — 566×294, **1.92:1**, radius 24px, drop shadow

## Component Tokens
- border-radius: 4px, 8px (buttons, 8×), 24px (cards/cover), 100px & 1000px (pills/avatars, 14×)
- shadows: `rgba(20,20,20,0.08) 0 0 0 0.5px inset` (hairline, 9×); `rgba(0,0,0,0.1) 0 1px 4px` (registration card, 1×)
- layout: two-column, container 1600px, `body padding 0`, `max-width: none`
- motion: `all 0.3s cubic-bezier(0.4,0,0.2,1)`; `:focus-visible` present; `prefers-reduced-motion` respected

---

# Taste DNA

### Depth by Contrast, Not by Weight
- **Trigger**: Separating event metadata, a registration widget, and long bilingual body copy on one screen.
- **Decision**: A flat grey field and 0.5px inset hairlines over drop-shadowed, elevated cards.
- **Reason**: A near-invisible edge marks a distinct thing without making the eye process a glow around every block — which lets the one true shadow mean "this is the widget that matters."
- **Evidence**: `#F2F2F2` covers 92.9% of surface; dominant "shadow" is `rgba(20,20,20,0.08) 0 0 0 0.5px inset` (9 uses); exactly one drop shadow (`0 1px 4px`), on the registration card.

### Color Is Information, Not Identity
- **Trigger**: Deciding how much brand amber to spend across a page full of clickable things — CTA, links, badges, icons.
- **Decision**: Amber spent on one concept only — "Require Approval" — with the primary CTA painted neutral near-black.
- **Reason**: If everything interactive is colored, color stops meaning anything; reserving amber for a single gate means one glance down the ticket list tells you which options will make you wait.
- **Evidence**: amber `#D69712` appears 3× at <1% surface area, only on approval badges; the "Request to Join" button is `#141414`, not amber; every other control is neutral.

### One Web Font, Spent at the Top
- **Trigger**: Deciding how many typefaces to load for a page that is 95% dense informational text in two languages.
- **Decision**: `Google Sans Flex` for the h1 alone; everything else — body, buttons, labels, Thai copy — in the native `-apple-system` stack.
- **Reason**: A visitor deciding whether to RSVP wants the page to appear instantly and read like their own OS; one branded headline buys identity, and paying web-font cost for body text would only slow that first paint.
- **Evidence**: `Google Sans Flex` = 8 uses (h1 only, 48px/575); `-apple-system` = 271 uses spanning 16px body, 14px UI, and all Thai text; body `max-width: none`.

### Trusted Whitespace Over the Card Reflex
- **Trigger**: Laying out a long description with sub-sections — schedule, partners, bilingual repeats — where the easy move is to wrap each in its own card.
- **Decision**: The entire "About Event" body left as flat left-aligned text separated only by whitespace and thin header rules; cards reserved for genuinely actionable content.
- **Reason**: Cards signal "act on me"; using them for read-only prose cries wolf, so the one card that matters — registration — loses its pull. Whitespace groups just as well for text you only read.
- **Evidence**: `gridCount: 0`, `sectionGaps: []` (no boxed sections); only 2 card components exist (cover image + registration), both actionable; body is one continuous left-aligned column with 18px paragraph rhythm and hairline rules under section heads.
