# Turning a game's components into an import file

This file is a set of instructions for an AI model. Give it this file and a game's components: a card list, a spreadsheet, a data file, or photos and scans of the cards, tiles or boards. It produces one JSON file that the site's owner loads with **Admin → Backup → Import → Merge**. That adds the components to the site and leaves its rules, rulesets and discussions alone.

To turn a rulebook into rules, use [IMPORT-RULEBOOK.md](IMPORT-RULEBOOK.md).

---

## Your task

You are converting a board game's physical components into a JSON import file for a "living rulebook" website. On that site every component can be browsed, filtered, discussed and printed. Components can be cards, tiles, boards, player mats, tokens, dice or anything else with game data on it.

Produce **one JSON file** in the exact format below, containing:

1. One **component type** per kind of component (e.g. "Battle cards", "Region tiles", "Player mats"). A type defines the type's data fields and how a component of that type is drawn as a card.
2. The **components** themselves, one entry per distinct component, with the values printed on it.
3. If the components show icons, the **shorthands** that stand for them.

Output only the JSON: no commentary before or after it, and no Markdown code fences around it. It must parse with a strict JSON parser: no comments and no trailing commas.

---

## The file

```json
{
  "format": "brv-backup",
  "version": 1,
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "description": "Game name: cards and tiles",
  "collections": {
    "componentTypes": {},
    "components": {},
    "config": {}
  }
}
```

- `format` must be exactly `"brv-backup"`, and `version` must be `1`.
- Each collection is an **object keyed by document id**, not an array.
- Include **only** these three collections: no `rules`, `sections`, `versions` or `rulesets`.
- Leave out `config` when the components have no icons.

---

## 1. Decide the component types

Group the components into types. Components belong to the same type when they share the same fields and the same shape:

- **Cards with different layouts** (e.g. unit cards with cost and strength, and event cards with only text) may still be one type if most fields overlap. Fields a card doesn't use are simply left out. Make separate types when the layouts are clearly different.
- **Different physical things** (cards, tiles, mats) are always separate types.
- **Tiny sets** of one or two identical-looking items (e.g. a first-player token) usually don't need a type at all. Leave them out unless they carry game data.

A type id is lowercase with `-`, e.g. `unit-cards`, `region-tiles`, `player-mats`.

## 2. The component type: `componentTypes`

| Field | Value |
| --- | --- |
| `name` | The name shown on the site, e.g. `"Unit cards"` |
| `order` | 1, 2… (the order types are listed in) |
| `aspect` | Width ÷ height of the physical item: `0.714` for poker cards (63 × 88 mm), `0.646` for mini cards (41 × 63.5 mm), `1` for square tiles. Measure or estimate it from the images |
| `emptyValues` | Values in the source that mean "nothing here", e.g. `["n/a", "-", "—"]` |
| `accentField` | The key of a `type` field whose value colors each component (e.g. faction or card type), or `""` |
| `accentColors` | `{ "<value>": "#hex" }` for each value of that field. Take the colors from the components if you can see them |
| `defaultAccent` | A `#hex` color for anything else |
| `fields` | The data fields (see 3) |
| `layout` | How the fields are drawn (see 4) |

## 3. Fields

Each field: `{ "key": "cost", "label": "Cost", "kind": "value", "filterable": false, "urlTemplate": "" }`

- `key`: lowercase letters, digits and `_`, e.g. `cost`, `card_type`.
- `label`: the name people see, e.g. `"Card type"`.
- `kind`: one of the following.

| `kind` | For | Notes |
| --- | --- | --- |
| `id` | The component's number or code | **Exactly one** per type. Unique within the type: use the printed number, or make one up in a stable order (1, 2, 3…) |
| `title` | The component's name | Doesn't have to be unique |
| `type` | A category: faction, color, card type, region, rarity… | Set `filterable: true` for the categories people will want to filter by |
| `value` | A number: cost, strength, points, quantity | Store it as a JSON number; it sorts numerically |
| `ability` | Game text | HTML and `[shorthands]` allowed (see 6) |
| `lore` | Flavor text | |
| `image` | Artwork | A full `https://` URL, or a file name together with `urlTemplate`, e.g. `"https://example.com/art/{value}.jpg"` |
| `state` | Marks a component as another side or state of a different component (a flipped card, an upgraded unit) | At most one per type; see 5 |

Add a `value` field called `quantity` when a component exists in several copies. Make **one** entry per distinct component, not one per copy.

## 4. Layout: how a component is drawn

The site draws every component as a card from this layout: rows from top to bottom, and in each row the fields side by side. Make it resemble the real component: name on top, cost in a corner, text below.

```json
"layout": {
  "rows": [
    { "band": true, "fill": false, "divider": false, "cells": [
      { "key": "title", "width": 4, "size": "l", "align": "left", "bold": true, "italic": false, "muted": false, "upper": false, "label": false, "prefix": "", "suffix": "" },
      { "key": "cost", "width": 1, "size": "l", "align": "right", "bold": true, "italic": false, "muted": false, "upper": false, "label": false, "prefix": "", "suffix": "[coin]" }
    ] },
    { "band": false, "fill": false, "divider": false, "cells": [
      { "key": "faction", "width": 1, "size": "s", "align": "left", "bold": false, "italic": false, "muted": true, "upper": true, "label": false, "prefix": "", "suffix": "" },
      { "key": "card_type", "width": 1, "size": "s", "align": "right", "bold": false, "italic": false, "muted": true, "upper": true, "label": false, "prefix": "", "suffix": "" }
    ] },
    { "band": false, "fill": false, "divider": false, "cells": [
      { "key": "strength", "width": 1, "size": "xl", "align": "left", "bold": true, "italic": false, "muted": false, "upper": false, "label": true, "prefix": "+", "suffix": "" }
    ] },
    { "band": false, "fill": true, "divider": true, "cells": [
      { "key": "ability", "width": 1, "size": "m", "align": "left", "bold": false, "italic": false, "muted": false, "upper": false, "label": false, "prefix": "", "suffix": "" }
    ] }
  ]
}
```

- **Row options:**
  - `band`: a strip in the accent color, for the title row;
  - `fill`: the row takes the remaining height, for the main text;
  - `divider`: a line above the row.
- **Cell options:**
  - `width`: share of the row;
  - `size`: `xs`, `s`, `m`, `l`, `xl` or `xxl`;
  - `align`: `left`, `center` or `right`;
  - `bold`, `italic`, `muted` (grey), `upper` (capitals);
  - `label`: shows the field's name above the value, as in "STRENGTH +2";
  - `prefix` and `suffix`: text around the value, e.g. `"+"` or `"[coin]"`.
- **Every cell needs all of these keys.**
- **What to place:** the fields a player reads on the component. Leave out `id` and `state` fields, `quantity`, and internal or old fields.
- **The type's name:** the special key `__type` (not a field; don't list it in `fields`) shows the component type's `name` on every component, e.g. a small `"size": "xs", "muted": true, "upper": true` cell in the last row.
- **Empty cells:** a cell whose value is empty is left out for that component, so one layout works for components that use different fields.
- **For tiles, boards and tokens:** keep it simple, with the name in a band and the text in a `fill` row.

## 5. Components: `components`

Id: `<type id>__<id value>`, with **two** underscores: e.g. `unit-cards__17`, `region-tiles__A3`. In the id value, replace any `/ \ . # $ [ ]` with `-`.

```json
"components": {
  "unit-cards__17": { "typeId": "unit-cards", "data": { "id": 17, "title": "Ambush", "faction": "Wolves", "card_type": "Tactic", "cost": 2, "ability": "<p>Play before combat: +2 [attack].</p>", "quantity": 2 } }
}
```

- `data` holds one value per field key. Numbers are JSON numbers. Leave a missing value out, or use one of the type's `emptyValues`.
- **Copy the printed text verbatim.** Don't reword, summarize, or fix the game's wording; write icons as shorthands.
- **When reading from images,** transcribe exactly what is printed. If something is unreadable, write `[unreadable]` in its place, never a guess. Don't invent components that aren't in the source.
- **Two-sided or upgradable components:** each side or state is its own component, numbered after the others. Its `state` field is `{ "of": "<id value of the main side>", "name": "Back" }`, or `"Upgraded"` and so on. The main side has no `state` value. The site then shows them as one component with switchable states.

## 6. Text and icons

Game text (`ability` and `lore` fields) is simple HTML. Allowed tags: `p` `br` `b` `strong` `i` `em` `u` `s` `ul` `ol` `li` `small` `sup` `sub` `span` `div` `hr`

- Wrap paragraphs in `<p>…</p>`. Keep the component's emphasis: bold keywords as `<b>`, italics as `<i>`.
- Plain fields (`title`, `type`, `value`) hold plain text or numbers, not HTML.
- **Boxed text** printed on a component (a reminder or a highlighted clause) can be a note box: `{box 2}<p>…</p>{/box}` uses box style 2, and `{box 2 Reminder}` gives it a heading of its own. The eight styles are set by the site's admins (by default 1 Tip, 2 Note, 3 Warning, 4 Changed, 5 Example, 6 Lore). Use them sparingly; most card text needs none.
- **Icons:** write each icon as a lowercase keyword in square brackets (`[coin]`, `[attack]`, `[shield]`), the same keyword for the same icon everywhere. List them in `config`:

```json
"config": {
  "shorthands": {
    "items": {
      "coin": { "type": "emoji", "value": "🪙" },
      "attack": { "type": "emoji", "value": "⚔️" }
    }
  }
}
```

- Keywords use only `a–z`, `0–9`, `-` and `_`. `type` is `"emoji"` (with an emoji `value`) or `"image"` (with an `https://` URL `value`).
- **Include every shorthand the site uses, not only the new ones.** Importing replaces the whole shorthand list. If you were told which shorthands the site already has (from its rulebook import or from **Admin → Components → Shorthands**), copy them in and add the new ones.

---

## Before you output: check

- [ ] The JSON parses: no comments, no trailing commas, and quotes are escaped.
- [ ] The file holds only `componentTypes`, `components` and (if needed) `config`.
- [ ] Each type has exactly one `id` field, and every `id` value is unique within its type.
- [ ] Every component's `typeId` exists, and its document id is `<typeId>__<id value>`.
- [ ] Every layout cell's `key` is one of that type's fields, and every cell has all its keys.
- [ ] `accentField` is `""` or the key of a `type` field; the `accentColors` keys match that field's actual values.
- [ ] Numbers are numbers (`2`, not `"2"`), and missing values are left out or listed in `emptyValues`.
- [ ] Every `[keyword]` used is defined in `config.shorthands.items`.
- [ ] The text is verbatim; nothing is invented, and unreadable parts are marked `[unreadable]`.
- [ ] Every `state` points at an existing main component (`of` is that component's id value).

## If there are too many components for one answer

Split by type, or by ranges within a type. Each part must be a **complete, valid file**:

- Put the type's `componentTypes` entry in **every** part that has components of that type, identical each time.
- Include `config` only in the **last** part.

The owner imports every part with **Merge**.

---

## For the site's owner

1. Give an AI model this file and the components (spreadsheet, list or images), and save its answer as a `.json` file.
2. In **Admin → Backup → Import**, choose the file and pick **Merge**:
   - Untick *Site settings & shorthands* if the file's shorthands are incomplete; add the missing ones in **Admin → Components → Shorthands** instead.
   - Importing a type again replaces its fields and layout, and updates the components with the same id.
3. Check the result on the Components page, and fine-tune the look in **Admin → Components → Fields & layout**.
4. To attach rules to a component (shown beside it in its details), use the component's admin tools on the site.
