# Turning a rulebook into an import file

This file is a set of instructions for an AI model. Give it this file and a game's rulebook (PDF, scans or text). It produces one JSON file that the site's owner loads with **Admin → Backup → Import**.

---

## Your task

You are converting a board game rulebook into a JSON import file for a "living rulebook" website. On that site every rule is a separate entry that people can read, search, discuss and propose changes to.

Produce **one JSON file** in the exact format below, containing:

1. The rulebook's **sections**: its chapters and headings, nested as in the book.
2. The **rules**: the book split into short, self-contained entries, each with a title.
3. One **version** per rule, holding the rule's text **verbatim** from the book, labeled `Rulebook`.
4. A **ruleset** that uses all those versions, marked as the site's default.
5. Optionally, **shorthands** for icons used in the text.

Output only the JSON: no commentary before or after it, and no Markdown code fences around it. It must parse with a strict JSON parser: no comments and no trailing commas.

---

## The file

```json
{
  "format": "brv-backup",
  "version": 1,
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "description": "Game name: transcribed rulebook (edition, year)",
  "collections": {
    "sections": {},
    "rules": {},
    "versions": {},
    "rulesets": {},
    "config": {}
  }
}
```

- `format` must be exactly `"brv-backup"`, and `version` must be `1`.
- Each collection is an **object keyed by document id**, not an array: `{ "id-1": { … }, "id-2": { … } }`.
- **Timestamps** are written as `{ "__ts": <milliseconds since 1970> }`. Use one fixed time for everything, for example `{ "__ts": 1767225600000 }` (1 January 2026).
- **Document ids** may use letters, digits, `-` and `_`. They must not contain `/` or `.`, and must not start and end with `__`. Keep them stable and readable. The ids below follow a pattern; use it.

---

## 1. Sections: `sections`

The book's chapters and sub-headings, as a tree.

| Field | Value |
| --- | --- |
| `title` | The heading as printed, e.g. `"Setup"` |
| `parent` | The id of the parent section, or `null` for a top-level chapter |
| `order` | The position among its siblings: 1, 2, 3… |

Id: a short uppercase code, e.g. `SET` for Setup and `SET-BRD` for "Setting up the board".

```json
"sections": {
  "INT": { "title": "Introduction", "parent": null, "order": 1 },
  "SET": { "title": "Setup", "parent": null, "order": 2 },
  "SET-BRD": { "title": "Setting up the board", "parent": "SET", "order": 1 }
}
```

The site numbers sections itself (1, 2, 2.1…), so don't put numbers in titles unless they are part of the printed name.

## 2. Rules: `rules`

**Split the book into rules.** A rule is the smallest piece that makes sense on its own and that someone might want to discuss, cite or change. Usually that is a paragraph or a short group of paragraphs about one thing: "Summoning a figure", "Ties for majority", "End of the game". Guidelines:

- **One idea per rule.** A long paragraph that covers three steps may become three rules. Three short paragraphs about one step stay together.
- **Keep the book's order.** Every piece of rules text belongs to exactly one rule. Leave nothing out, and don't repeat text across rules.
- **Examples, sidebars, tips, flavor text and quick-reference boxes are rules too**, with a fitting `kind` (see below).
- Leave out the cover, the credits, the table of contents and the index.

| Field | Value |
| --- | --- |
| `sectionId` | The id of the section it belongs to (the deepest one) |
| `order` | Its position within that section: 1, 2, 3… |
| `title` | A short, descriptive title (2–6 words). Use the book's own heading when the rule has one; otherwise write a neutral one, e.g. `"Ties for majority"` |
| `kind` | `"rule"` for ordinary rules; otherwise one of the kinds below |
| `page` | The printed page number (a number), or `null` |
| `status` | Always `"active"` |
| `commentCount` | Always `0` |
| `createdAt` | The fixed timestamp |
| `createdBy` | Always `"import"` |
| `createdByName` | Always `"Rulebook"` |

**Kinds.** Use these ids, which match the site's defaults:

| `kind` | For |
| --- | --- |
| `rule` | Ordinary rules (no badge is shown) |
| `note` | Clarifications and notes |
| `tip` | Strategy tips and advice |
| `example` | Worked examples |
| `flavor` | Story and atmosphere text |
| `summary` | Quick-reference and summary boxes |
| `change` | Differences from an earlier game or edition (the book marks these) |

To use other kinds, or to rename one (say `change` should read "Changed from the first edition"), add a `kinds` list to `config/site` (see 5).

Id: `r-` plus the section id in lowercase plus a running number, e.g. `r-set-brd-1`, `r-set-brd-2`.

```json
"rules": {
  "r-set-brd-1": { "sectionId": "SET-BRD", "order": 1, "title": "Placing the board", "kind": "rule", "page": 4, "status": "active", "commentCount": 0, "createdAt": { "__ts": 1767225600000 }, "createdBy": "import", "createdByName": "Rulebook" }
}
```

## 3. Versions: `versions`

Every rule needs exactly **one** version: the printed text.

| Field | Value |
| --- | --- |
| `ruleId` | The rule's id |
| `label` | Always `"Rulebook"` |
| `text` | The rule's text, **verbatim**, as simple HTML (see below) |
| `n` | Always `1` |
| `note` | `""` |
| `reactions` | `{}` |
| `createdAt`, `createdBy`, `createdByName` | As for the rule |

Id: `v-` plus the rule id without its `r-`, plus `-rulebook`, e.g. `v-set-brd-1-rulebook`.

**The text must be verbatim.** Copy the rulebook's wording exactly: don't summarize, reword, correct, or "improve" it. You may only:

- fix broken line breaks and hyphenation from the PDF ("sum-\nmon" → "summon");
- turn the layout into simple HTML;
- write icons as shorthands (see 4).

**Allowed HTML** (anything else is removed):

`p` `br` `b` `strong` `i` `em` `u` `s` `ul` `ol` `li` `blockquote` `small` `sup` `sub` `code` `hr` `h4` `h5` `a` (with `href`) `img` (with `src` and `alt`) `figure` `figcaption` `span` `div`

- Wrap every paragraph in `<p>…</p>`, and use `<ul>`/`<ol>` with `<li>` for lists.
- Keep the book's emphasis: **bold** keywords as `<b>`, italics as `<i>`.
- Use `<h4>` only for a sub-heading *inside* one rule's text, not for section headings, which belong in `sections`.
- Don't embed images unless you have a public `https://` URL for them. A diagram you can't reproduce becomes a short note in the text, e.g. `<p><i>[Diagram: the board with 9 regions and their pathways]</i></p>`.
- Escape only what JSON requires (`"` as `\"` and `\` as `\\`). Characters such as `’`, `—` and `×` can stay as they are.

```json
"versions": {
  "v-set-brd-1-rulebook": { "ruleId": "r-set-brd-1", "label": "Rulebook", "text": "<p>Place the <b>game board</b> in the middle of the table.</p>", "n": 1, "note": "", "reactions": {}, "createdAt": { "__ts": 1767225600000 }, "createdBy": "import", "createdByName": "Rulebook" }
}
```

**Official errata or FAQ.** If you are also given official rulings, add them to the rule they change as a second version: label `"Official Ruling"`, `n: 2`, the ruling's text, and its source in `note` (e.g. `"FAQ v1.2"`). Its id ends in `-official`. The `Rulebook` version stays as printed.

## 4. Shorthands: `config/shorthands`

Rulebooks often print small icons inside the text (a coin, a sword, a heart). Write each icon as a lowercase keyword in square brackets, such as `[coin]`, `[attack]` or `[health]`, and list it here. The site shows the keyword as an emoji (or as an image, if it has a URL).

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

- Keywords use only `a–z`, `0–9`, `-` and `_`.
- `type` is `"emoji"` (with an emoji `value`) or `"image"` (with an `https://` URL `value`).
- Use the same keyword for the same icon everywhere, in rules and on cards.

## 5. The ruleset and site settings: `rulesets`, `config/site`

One ruleset holds every rule in its printed version, and becomes the site's default.

```json
"rulesets": {
  "rs-rulebook": {
    "name": "Rulebook",
    "description": "Every rule as printed in the rulebook.",
    "label": "Official",
    "visibility": "public",
    "entries": { "r-set-brd-1": "v-set-brd-1-rulebook" },
    "ownerUid": "import",
    "ownerName": "Rulebook",
    "createdAt": { "__ts": 1767225600000 },
    "updatedAt": { "__ts": 1767225600000 }
  }
},
"config": {
  "site": { "defaultRulesetId": "rs-rulebook" },
  "shorthands": { "items": { } }
}
```

- `entries` must list **every** rule: `"<rule id>": "<its Rulebook version id>"`.
- `name` may name the edition, e.g. `"Rulebook, 2nd edition"`. Keep `description` under 80 characters.
- To define rule kinds (see 2), add them to `config/site`: `"kinds": [{ "id": "rule", "label": "Rule", "color": "#9c9087" }, { "id": "note", "label": "Note", "color": "#6d9ccf" }, …]`. Include `rule`, and every kind your rules use.

## 6. Cards and other components

Leave them out of this file. Cards, tiles, boards and other components have their own instructions, [IMPORT-COMPONENTS.md](IMPORT-COMPONENTS.md), and their own import file, which the owner adds afterwards with **Merge**. If you were given that file and the components as well, produce the components file as a second, separate answer. Use the same shorthand keywords in both.

---

## Before you output: check

- [ ] The JSON parses: no comments, no trailing commas, and quotes are escaped.
- [ ] Every rule's `sectionId` exists in `sections`, and every section's `parent` is `null` or an existing section.
- [ ] Every rule has exactly one `Rulebook` version, and every version's `ruleId` exists.
- [ ] `rulesets.rs-rulebook.entries` lists every rule with its Rulebook version id.
- [ ] `config.site.defaultRulesetId` is `"rs-rulebook"`.
- [ ] `order` runs 1, 2, 3… within each section, in the book's order.
- [ ] Every `kind` is in the kind list (the defaults, or your `config/site.kinds`).
- [ ] Every `[keyword]` in the text is defined in `config.shorthands.items`.
- [ ] The text is verbatim: nothing is reworded, summarized or skipped.

## If the rulebook is too long for one answer

Split the work by chapter. Each part must be a **complete, valid file** in the format above, with the `sections`, `rules` and `versions` of that chapter. Make sure:

- ids never collide between parts;
- only the **last** part carries `config` and `rulesets`, and its `entries` list every rule of **every** part. An import writes each document whole, so a ruleset in an earlier part would be replaced, not added to.

The owner imports the first part with **Replace** and the others, in order, with **Merge**, which adds them without removing anything.
