# Stillgreen design system

One look for the website, the web dashboard, the daemon's control page and the
Chrome extension. Light ("A: Clean light") is the default; dark ("B: Dark pro")
turns on by itself when the computer is in dark mode. Same layout, same
components, two sets of colors.

The bar is Linear, Vercel and Resend: calm, exact, quick. Plain words, one green
accent, no decoration that doesn't carry meaning.

## Where things live

| What | Website (React) | Daemon page and extension (plain HTML) |
| --- | --- | --- |
| Tokens | `app/globals.css` (between `@tokens:start` / `@tokens:end`) | `sg_local/static/tokens.css`, `extension/tokens.css` |
| Components | `components/ui/*` (CSS modules) | `sg_local/static/ui.css`, `extension/ui.css` |
| Icons | `components/icons.tsx` | inline `<svg>` (copy the paths from `components/icons.tsx`) |
| Logo | `components/brand.tsx` (`Brand`, `BrandMark`) | `.logo` markup in the page |
| Header / footer | `components/site-header.tsx`, `components/site-footer.tsx` | — |
| Links | `lib/site.ts` (`GITHUB_URL`, `README_URL`, …) | — |

The token block is copied into three files and `ui.css` into two. Edit
`sg_local/static/tokens.css` (or `ui.css`) first, then copy it:

```sh
cp sg_local/static/tokens.css extension/tokens.css
cp sg_local/static/ui.css extension/ui.css
# and paste the same @tokens block into app/globals.css
```

`tests/test_design_tokens.py` fails if the copies drift, or if a color exists
in one theme but not the other.

### Using it on a plain page

The daemon serves `/tokens.css` and `/ui.css` (see `sg_local/web.py`). Load them
before the page's own CSS. Both work under the daemon's CSP (no inline scripts,
no outside fonts):

```html
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/ui.css">
<link rel="stylesheet" href="/app.css">
```

The extension popup uses relative paths: `tokens.css`, `ui.css`, `popup.css`.
These pages use system fonts only; the font stack starts with Inter and falls
back to the system UI font.

## Themes

- Default: light.
- `prefers-color-scheme: dark`: dark.
- `<html data-theme="light">` or `<html data-theme="dark">` forces one theme
  either way (for a future toggle). Nothing sets it today.

Never hard-code a color in a component. Use a token, so both themes work.

## Tokens

### Color

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#ffffff` | `#0a0a0b` | Page background |
| `--bg-subtle` | `#fafafa` | `#0a0a0b` | App canvas behind cards (dashboard) |
| `--surface` | `#ffffff` | `#111214` | Cards, dialogs, toasts |
| `--surface-2` | `#fafafa` | `#17181b` | Card footers, code blocks, insets |
| `--surface-3` | `#f4f4f5` | `#1d1e22` | Segmented track, deeper insets |
| `--border` | `#e5e5e5` | white 8% | Card and divider lines |
| `--border-strong` | `#d4d4d4` | white 14% | Stronger lines, kbd |
| `--text` | `#0a0a0a` | `#ededed` | Main text |
| `--text-muted` | `#525252` | `#a1a1aa` | Body copy, secondary text |
| `--text-subtle` | `#737373` | `#8a8a93` | Hints, captions, timestamps |
| `--text-placeholder` | `#767676` | `#7c7c85` | Input placeholders |
| `--accent` | `#16a34a` | `#22c55e` | Status dots, focus rings, icons |
| `--accent-hover` | `#15803d` | `#4ade80` | Hover for accent things |
| `--accent-text` | `#15803d` | `#4ade80` | Green text and links |
| `--accent-soft` / `--accent-border` | green 50 / 200 | green 10% / 28% | Selected and success fills |
| `--success` `--warning` `--danger` `--info` `--violet` | | | Dots and icons |
| `--{tone}-text` / `--{tone}-soft` / `--{tone}-border` | | | Badge, banner text, fill and line |
| `--primary-bg` / `-hover` / `--primary-text` | green `#15803d` / white | `#ededed` / `#0a0a0b` | Primary button |
| `--destructive-bg` / `-hover` | `#dc2626` / `#b91c1c` | same | Destructive button |
| `--control-bg` / `--control-border` (+ `-hover`) | | | Secondary buttons, chips, inputs |
| `--input-bg` | `#ffffff` | `#0a0a0b` | Inputs |
| `--hover` | `#f4f4f5` | `#1d1e22` | Hover fill for ghost things |
| `--selected-bg` / `-border` / `-text` | | | Pressed chips |
| `--inverse-bg` / `--text-inverse` | | | Skip link, inverse pills |
| `--overlay` | | | Dialog backdrop |

Why two greens: white text on `#16a34a` is only 3.3:1, below WCAG AA for normal
text. Filled buttons and green text use the darker `#15803d` (5.5:1). The
brighter `#16a34a` is for dots, rings and icons, which need 3:1. In dark mode
the primary button is near-white (as in the "Dark pro" mockups) and green stays
for status.

**This is a deliberate change from mockup A**, whose primary button is
`#16a34a`. Keep `--primary-bg` at `#15803d` in `app/globals.css`,
`sg_local/static/tokens.css` and `extension/tokens.css`; switching it back
fails AA for the button label.

All text tokens pass AA (4.5:1) on `--bg`, `--surface` and `--surface-2` in both
themes.

### Type

Inter for UI (`--font-sans`), JetBrains Mono for codes, hosts, URLs, commands
and times (`--font-mono`). The site loads both with `next/font`; plain pages use
the installed font or the system font.

| Token | Size / line | Use |
| --- | --- | --- |
| `--font-size-xs` | 12 / 16 | Hints, badges, captions |
| `--font-size-sm` | 13 / 20 | Secondary text, small buttons, mono values |
| `--font-size-base` | 14 / 20 | UI default |
| `--font-size-md` | 16 / 24 | Dialog titles, emphasis |
| `--font-size-lg` | 18 / 28 | Lead paragraphs |
| `--font-size-xl` | 20 / 28 | Small section titles |
| `--font-size-2xl` | 24 / 32 | Page titles ("Overview") |
| `--font-size-3xl` | 32 / 40 | Marketing section titles |
| `--font-size-4xl` | 44 / 52 | Hero on small screens |
| `--font-size-display` | 56 / 60 | Hero |

Each size has a matching `--line-height-*`. Weights: 400, 500, 600 only.
Tracking tightens as size grows: `--tracking-normal` (-0.006em, UI),
`--tracking-tight` (-0.015em, 16–20px), `--tracking-tighter` (-0.025em, 24–32px),
`--tracking-display` (-0.035em, 44px+). Use `font-variant-numeric: tabular-nums`
(`.tnum`) for times and counts that change.

### Space, size, radius

- Spacing is a 4px grid: `--space-1` 4px, `-2` 8, `-3` 12, `-4` 16, `-5` 20,
  `-6` 24, `-8` 32, `-10` 40, `-12` 48, `-16` 64, `-20` 80, `-24` 96.
- Control heights: `--control-sm` 32px, `--control-md` 36px, `--control-lg` 40px.
- Icons: `--icon-sm` 14px (small controls), `--icon-md` 16px.
- Radius: controls `--radius` 8px, cards and dialogs `--radius-lg` 12px, small
  things `--radius-sm` 6px / `--radius-xs` 4px, toasts `--radius-md` 10px,
  pills `--radius-full`.
- Layout: `.container` gives 1200px content (`--container`) with a gutter of
  16px on phones, 24px from 640px, 32px from 1024px (`--gutter`).

### Elevation, focus, motion

- `--shadow-xs` (controls), `--shadow-sm` (selected segment), `--shadow-md`
  (toasts, menus), `--shadow-lg` (dialogs), `--shadow-card` (cards; none in light).
- Focus: every interactive element shows a ring on keyboard focus.
  Buttons, chips and links use `--focus-ring` (2px gap + 2px green). Inputs use
  a green border plus `--focus-ring-input`. Never remove a focus style without
  replacing it.
- Motion: `--duration-fast` 120ms for hovers, `--duration` 180ms for dialogs and
  toasts, easing `--ease`. Only color, opacity and small transforms. Everything
  is switched off under `prefers-reduced-motion: reduce`. No scroll effects,
  parallax, marquees or custom cursors.

## Components (React, `components/ui`)

Import from the barrel:

```tsx
import { Button, Card, CardHeader, CardBody, Badge, Field, Input } from "@/components/ui";
```

### Button

Variants: `primary`, `secondary` (default), `ghost`, `destructive`,
`destructive-ghost` (quiet red text, for "Remove" in a list), `link`.
Sizes: `sm` 32px, `md` 36px (default), `lg` 40px.

```tsx
<Button variant="primary" onClick={keepOn}>Keep on</Button>
<Button icon={<Pause />} size="sm">Pause</Button>
<Button variant="primary" loading={saving}>{saving ? "Saving" : "Save schedule"}</Button>
<Button href="/dashboard" variant="primary" iconRight={<ArrowRight />}>Open dashboard</Button>
<Button href="https://github.com/…">GitHub</Button>          {/* external: opens a new tab */}
<Button variant="destructive-ghost" icon={<Trash />} onClick={askToRemove}>Remove</Button>
```

- `href` renders a link (Next `<Link>` for `/` and `#` paths). `disabled` on a
  link sets `aria-disabled` and blocks clicks.
- `loading` shows a spinner in place of `icon`, sets `aria-busy` and blocks
  clicks, but keeps full color. Change the label to say what is happening.
- `block` makes it full width.
- `buttonClassName({ variant, size })` gives the classes for an element that
  can't be a `<Button>` (safe in server components).

### IconButton

A square button with only an icon. `label` is required: it is the accessible
name and the tooltip.

```tsx
<IconButton label="Copy access code" onClick={copy}><Copy /></IconButton>
<IconButton label="Stillgreen on GitHub" href={GITHUB_URL}><Github /></IconButton>
```

### Badge

Tones: `success` (active, online), `warning` (paused), `danger` (needs you),
`info` (connected, working on it), `violet` (manual away), `neutral` (default).

```tsx
<Badge tone="success" dot>Active</Badge>
<Badge tone="warning" dot>Paused</Badge>
<Badge>v1.4.2</Badge>
```

Status needs words, not only a color: always keep the label.

### Card

```tsx
<Card>
  <CardHeader
    title="Keep me online"
    description="Stay green past your schedule, just for now."
    actions={<Badge tone="success" dot>Active</Badge>}
  />
  <CardBody>…</CardBody>
  <CardFooter>
    <span>You'll stay active until 3:46 PM.</span>
    <Button variant="primary" size="sm">Keep on</Button>
  </CardFooter>
</Card>
```

`Card` renders a `<section>` (pass `as="div"` for plain boxes). `CardHeader`
uses an `h2`; change it with `titleAs`. `CardBody flush` removes padding for
lists whose rows bring their own. A `CardFooter` sticks to the bottom of a
stretched card.

### Field, Input, TimeInput, Textarea

`Field` wires the label, hint and error to the control (`id`,
`aria-describedby`, `aria-invalid`). The error replaces the hint and is
announced.

```tsx
<Field label="Daemon URL" hint="Shown in your terminal when the daemon starts.">
  <Input mono value={url} onChange={(e) => setUrl(e.target.value)} />
</Field>

<Field label="Access code" error={codeError}>
  <Input mono autoComplete="off" spellCheck={false} />
</Field>

<Field label="Until">
  <TimeInput value={until} onChange={(e) => setUntil(e.target.value)} />
</Field>
```

- `Input`: `size="sm"` for 32px, `mono` for URLs, codes and hosts, `icon` for a
  leading icon.
- `TimeInput` is `<input type="time">` (value `"HH:MM"`, 24-hour) with a clock
  icon that opens the browser's picker.
- `optional` on `Field` adds a quiet "Optional". Mark optional fields, not
  required ones.

### SegmentedControl

Pick one of two to four modes. A `role="group"` of toggle buttons
(`aria-pressed`).

```tsx
<SegmentedControl
  label="Schedule mode"
  value={mode}
  onChange={setMode}
  options={[
    { value: "always", label: "Always on" },
    { value: "scheduled", label: "Scheduled" },
  ]}
/>
```

### Chip and ChipGroup

Toggle chips for quick picks. Single choice by default; `multiple` for sets.

```tsx
<ChipGroup
  label="Keep me online for"
  value={minutes}
  onChange={setMinutes}
  options={[
    { value: "30", label: "30 min" },
    { value: "60", label: "1 h" },
    { value: "120", label: "2 h" },
    { value: "180", label: "3 h" },
  ]}
/>

<ChipGroup multiple label="Active days" value={days} onChange={setDays} options={weekdays} />
```

Use a single `<Chip pressed={…}>` when you need custom behavior.

### Dialog and ConfirmDialog

Built on the native `<dialog>` with `showModal()`: the page behind is inert,
Tab stays inside, Escape and a backdrop click call `onClose`, and focus returns
to where it was. Put `data-autofocus` on the control that should get focus
first (by default the first control does).

```tsx
<Dialog
  open={adding}
  onClose={() => setAdding(false)}
  title="Add a Slack workspace"
  description="Paste the two values from the extension."
  actions={
    <>
      <Button onClick={() => setAdding(false)}>Cancel</Button>
      <Button variant="primary" loading={saving}>Verify & add</Button>
    </>
  }
>
  <Field label="xoxc token"><Input mono /></Field>
</Dialog>

<ConfirmDialog
  open={removing}
  destructive
  title="Remove Acme Corp?"
  description="Stillgreen will stop keeping you green there and delete its saved Slack login. You can add it again any time."
  confirmLabel="Remove workspace"
  loading={busy}
  onConfirm={remove}
  onCancel={() => setRemoving(false)}
/>
```

`ConfirmDialog` focuses Cancel first, so Enter never deletes by accident.

One anatomy for every dialog, on the website, the control page and the
extension:

- A round tinted icon left of the title (red for destructive actions).
- Title, then a one- or two-sentence description.
- Optional content (fields, steps).
- Footer buttons, right-aligned, no divider above them. The safe choice comes
  first, the main action last. Under 480px they stack full width with the main
  action on top.
- No close (X) button. Cancel or Close in the footer, Escape and a backdrop
  click close it.
- When the control that opened it is gone (a removed row), pass `returnFocus`
  so focus lands somewhere sensible instead of the page body.

### Toast

`ToastProvider` is already in `app/layout.tsx`. Toasts appear bottom-right
(bottom-center on phones), in an `aria-live="polite"` region; danger toasts use
`role="alert"`. They close after 5 seconds, pause while hovered or focused,
and keep at most three.

```tsx
const { toast } = useToast();
toast({ tone: "success", title: "Staying online", description: "Until 3:46 PM today" });
toast({ title: "Acme Corp paused", action: { label: "Undo", onClick: resume } });
toast({ tone: "danger", title: "Couldn't reach your daemon", duration: 0 });
```

Use a toast to confirm something the person just did. Use a `Banner` for a
problem that stays until fixed.

### Banner (also exported as Alert)

```tsx
<Banner tone="warning" title="Slack rejected the tokens for Acme Corp"
  actions={<Button size="sm">Capture again</Button>}>
  Open Slack in Chrome and click Capture from Slack in the extension.
</Banner>
<Banner tone="info">Your tokens stay on your computer. They never go to this website.</Banner>
```

Tones: `neutral`, `info`, `success`, `warning`, `danger`.

### EmptyState

```tsx
<EmptyState
  icon={<Grid />}
  title="No workspaces yet"
  description="Open Slack in Chrome and click Capture from Slack in the extension."
  actions={<Button variant="primary">Add workspace</Button>}
/>
```

### Skeleton

```tsx
<div aria-busy="true">
  <Skeleton width="60%" height={16} />
  <Skeleton width="90%" />
</div>
```

Use for the first load only. Keep old data on screen during refreshes.

### Kbd and CodeBlock

```tsx
Press <Kbd>Esc</Kbd> to close.
<CodeBlock prompt="$" code="sg-local start" copyLabel="Copy start command" />
<CodeBlock code={"git clone https://github.com/laxmideepak/Still-Green\ncd Still-Green"} />
```

The prompt is not copied. Multi-line code keeps its line breaks and scrolls
sideways instead of wrapping.

### Brand, header and footer

- `<Brand />` is the mark plus "Stillgreen", linking home. `compact` shows the
  mark only; `href={null}` renders it without a link. `<BrandMark />` is the
  mark alone. The mark stays dark in both themes.
- `<SiteHeader />`: logo; How it works (`/#how`), Setup (`/start`), CLI
  (`/setup`); GitHub icon; primary "Open dashboard". Under 768px it collapses
  into a menu button (Escape closes it). The home page must keep a section with
  `id="how"`.
- `<SiteFooter />`: product and project links, and the "not made by Slack" note.

## Plain-CSS classes (`ui.css`)

Same look and names for the daemon page and the extension. Base styles (box
sizing, body font, focus outline, reduced motion) come with the file.

| Component | Classes |
| --- | --- |
| Button | `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-destructive` (alias `.btn-danger`) / `.btn-destructive-ghost` / `.btn-link`; sizes `.btn-sm` / `.btn-lg`; `.btn-icon`, `.btn-block`; loading `.is-loading` + `aria-busy="true"` + `<span class="spinner"></span>` |
| Spinner | `.spinner` |
| Badge | `.badge` + `.badge-success` / `-neutral` / `-warning` / `-danger` / `-info` / `-violet`; dot `<span class="dot"></span>` |
| Card | `.card`, `.card-header`, `.card-title`, `.card-description`, `.card-body`, `.card-footer` |
| Field | `.field`, `.label`, `.hint`, `.field-error` (hidden when empty) |
| Input | `.input`, `.input-sm`, `.input.mono`, `textarea.input`, `.input-group` (leading `<svg>`), `.time-input`; error via `aria-invalid="true"` |
| Segmented | `.segmented` > `button[aria-pressed]` (or `aria-checked`, `.is-active`) |
| Chips | `.chip-group` > `.chip[aria-pressed]` |
| Dialog | `dialog.dialog` (`.dialog-lg`), `.dialog-body`, `.dialog-icon` (`.dialog-icon-danger`), `.dialog-title`, `.dialog-description`, `.dialog-content`, `.dialog-actions` |
| Toast | `.toast-region` (fixed, `aria-live="polite"`) > `.toast` (`.toast-success` / `-danger` / `-warning` / `-info`), `.toast-icon`, `.toast-text`, `.toast-title`, `.toast-description`, `.toast-action`, `.toast-close` |
| Banner | `.banner` + `.banner-info` / `-success` / `-warning` / `-danger`; `.banner-title`, `.banner-description`, `.banner-actions` |
| Empty state | `.empty`, `.empty-icon`, `.empty-title`, `.empty-description`, `.empty-actions` |
| Menu | `.menu` > `.menu-item` (`.menu-item-danger`) |
| Other | `.skeleton`, `.kbd`, `.code-block` (`.code-block-multiline`, `.prompt`), `.divider`, `.mono`, `.tnum`, `.visually-hidden` |

Examples:

```html
<button class="btn btn-primary" type="submit">Unlock</button>
<button class="btn btn-secondary btn-sm" type="button" aria-label="Pause Acme Corp">Pause</button>
<button class="btn btn-primary is-loading" aria-busy="true" disabled><span class="spinner"></span>Saving</button>

<span class="badge badge-success"><span class="dot"></span>Active</span>

<div class="field">
  <label class="label" for="code">Access code</label>
  <input class="input mono" id="code" aria-describedby="code-error">
  <p class="field-error" id="code-error" role="alert"></p>
</div>

<div class="input-group">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/></svg>
  <input class="input time-input" type="time" id="until">
</div>

<div class="segmented" role="group" aria-label="Schedule mode">
  <button type="button" aria-pressed="false">Always on</button>
  <button type="button" aria-pressed="true">Scheduled</button>
</div>

<dialog class="dialog" aria-labelledby="rm-title" aria-describedby="rm-text">
  <div class="dialog-body">
    <span class="dialog-icon dialog-icon-danger" aria-hidden="true"><svg>…</svg></span>
    <div>
      <h2 class="dialog-title" id="rm-title">Remove Acme Corp?</h2>
      <p class="dialog-description" id="rm-text">Stillgreen will stop keeping you green there and delete its saved Slack login.</p>
    </div>
  </div>
  <div class="dialog-actions">
    <button class="btn btn-secondary" type="button" autofocus>Cancel</button>
    <button class="btn btn-destructive" type="button">Remove workspace</button>
  </div>
</dialog>
```

Open plain dialogs with `dialog.showModal()` from your script file and close
them on the `cancel` event (Escape).

## Rules

Do:

- One primary button per view (per card at most, and usually per page). Other
  actions are secondary or ghost.
- Confirm anything destructive (remove a workspace, change the access code) in
  a dialog, with the safe button focused first and a confirm label that says
  what happens ("Remove workspace", not "OK").
- Write plain, short English. Say what happened and what to do next: "That code
  wasn't accepted. Copy it again from your control page."
- Use sentence case for labels and titles ("Keep me online", not "Keep Me Online").
- Pair every color with words or an icon. Status is never color alone.
- Use JetBrains Mono for codes, URLs, hosts, commands and times.
- Show clock times in the browser's own format (`Intl.DateTimeFormat` with
  `hour: "numeric", minute: "2-digit"`, as `clock()` in `lib/dashboard.ts` and
  `clockFmt` in `sg_local/static/app.js`), so they match the native time
  inputs next to them. Never hard-code a 24-hour or 12-hour cycle.
- Use the same words on the web dashboard and the control page for the same
  control: "Pause 1 h", "Pause until I resume", "Resume all", "Keep on for
  1 h", the stats "Online now / Mode / Next change / Last update".
- Say "Stillgreen", "your Stillgreen address", "access code" and "Slack login"
  in the interface. Not "daemon", "Daemon URL" or "tokens" (the two pasted
  values keep their real names, "xoxc token" and "xoxd cookie").
- Name the two guides the same everywhere: `/setup` is the "Setup guide"
  ("Setup" in the top nav), `/start` is the "Quick start".
- Keep to the 4px grid and the three control heights (32/36/40).
- Give icon-only buttons a label (`IconButton label`, or `aria-label`).
- Check both themes and a 390px-wide screen before calling a screen done.

Don't:

- Don't use `window.alert`, `window.confirm` or `window.prompt`. Use `Dialog`,
  `ConfirmDialog`, `Banner` or a toast.
- Don't invent people. No made-up names or avatars in the real UI; say
  "Overview", not "Good afternoon, Maya".
- Don't add new colors, shadows, radii or font sizes in a component. Add a
  token, or use an existing one.
- Don't use green for decoration. It means "on", "active" or "selected", plus
  the primary button in light mode.
- Don't animate layout, scroll or the cursor. Short color and opacity
  transitions only, and respect reduced motion.
- Don't promise what the product doesn't do. Facts to keep right: it's free;
  it runs on your own computer or your own cloud server; it never overrides an
  away status you set yourself; tokens never go to the website.

## Migrating old pages

`app/globals.css` ends with a LEGACY section that maps the old dark-theme
names (`--ink`, `--acid`, `--night`, `.button`, `.buttonPrimary`, …) to the new
tokens so pages that haven't moved yet still follow both themes. When you
rebuild a page, use `components/ui` and the new tokens, then remove the page's
old names. Delete the LEGACY section once the grep commands in its comment
find nothing. Also remove `components/motion/*` and the `motion` package when
nothing imports them (`grep -rn "motion/react\|components/motion" app components`,
then `npm uninstall motion`).
