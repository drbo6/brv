# Blood Rage Valhalla: Unofficial Living Rulebook

A community-maintained FAQ, rules-clarification and balancing hub for *Blood Rage: Valhalla*. It's a static site hosted on GitHub Pages, with Firebase handling sign-in and data.

- **Rules.** Every rule from the rulebook is a separate, numbered entry (such as 5.3.1.2) with its own permanent link. The rules read like a book; clicking one shows its tools. Each rule can have several versions, labeled *Rulebook*, *Official Ruling*, *Community* or *Suggestion*. People can react 👍 👎 ❓, discuss, and suggest new rules or new wording. Rule text can include externally hosted images. The rules are searchable, can be filtered, and can be exported to PDF.
- **Rulesets.** A ruleset picks which rules are active and which version of each rule is used. The built-in *Rulebook* ruleset always uses the printed text. Signed-in users can save their own rulesets and share them by link. Admins choose which rulesets are public and which one is the default.
- **Components.** A card browser with search, filters and sorting that stays fast with thousands of entries. Cards have versions (Printed, Official Ruling, Community, Suggestion), reactions and discussion just like rules, and a ruleset can pick which version of each card it uses. Admins define component types and their fields, arrange them on a simple card layout, import and export spreadsheets, and define `[shorthand]` icons.
- **Admin.** Admin chat, a suggestions queue, section management, ruleset publishing, component management, the admin list, and JSON backup & import of the whole database.
- **Undo.** Every change can be undone and redone: from the toast that confirms it, the ↶ button in the header, or Ctrl+Z / Ctrl+Shift+Z.
- **Inbox and following.** Signed-in users follow rules, cards, rulesets (and admins the suggestion feed) and get inbox notices about new comments, versions and changes. Commenting or suggesting follows automatically. A bell in the header shows unread notices.
- **View as.** Signed-in users and admins can preview the site as a signed-in user or a visitor, from the 👁 menu in the header.
- **Working together.** Everything updates live. Changes are written per field where possible, and editors warn you when someone else saved the thing you are editing.
- **Light and dark mode**, following the system setting until you pick one.
- **Help.** The Help page (`#/help`) explains every feature for readers, members and admins.

This is an unofficial fan project and is not affiliated with the game's publishers.

## Try it without Firebase

```bash
npm install
npm run demo
```

Demo mode swaps Firebase for an in-browser fake (`src/demo/`). Data is stored in your browser's localStorage, and security rules are not enforced. To try the admin tools, sign in with the name **Admin**. Then go to **Admin → Backup & import** and import [imports/blood-rage-valhalla.json](imports/blood-rage-valhalla.json).

## Set up for real

### 1. Firebase project

1. Create a project at <https://console.firebase.google.com>.
2. In **Build → Authentication → Sign-in method**, enable **Google**.
3. In **Authentication → Settings → Authorized domains**, add `<your-github-user>.github.io` (and any custom domain).
4. In **Build → Firestore Database**, create a database in production mode.
5. In **Project settings → Your apps**, add a **Web app** and copy its config.

### 2. Configure the site

Use one of these two options:

- Paste the config into [src/firebase-config.js](src/firebase-config.js). These values are not secret: access is enforced by the security rules.
- Or, in the GitHub repo, go to **Settings → Secrets and variables → Actions → Variables** and add `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID` and `VITE_FIREBASE_APP_ID`.

### 3. Deploy the security rules

Either paste [firestore.rules](firestore.rules) into **Firestore → Rules** in the console, or run:

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore --project <project-id>
```

No composite indexes are needed.

### 4. Publish on GitHub Pages

In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**. Every push to `main` builds and deploys the site through [.github/workflows/deploy.yml](.github/workflows/deploy.yml).

### 5. Make yourself the first admin

1. Open the site and log in. The **Account** page shows your user ID.
2. In the Firebase console, open **Firestore**, create a collection named `admins`, and add a document whose **ID is your user ID**. It can have any field, for example `name: "Your name"`.
3. Reload the site. An **Admin** tab appears. From then on you can promote other people from **Admin → People**.

### 6. Load the content

Go to **Admin → Backup & import**, choose [imports/blood-rage-valhalla.json](imports/blood-rage-valhalla.json) and import it in **Merge** mode. It contains:

- the rulebook, transcribed verbatim: 138 rules in 30 sections;
- a *Blood Rage: Valhalla cards* component type with a card layout, and the 132 cards from the card spreadsheet;
- the `[rage]`, `[axes]`, `[horns]` and `[tribute]` shorthands, shown as emoji (replace them with image URLs if you like).

The file uses fixed document IDs, so importing it again updates the same documents instead of adding duplicates. If you loaded the rulebook with an earlier version of the site, its rules have different IDs: import the file in **Replace** mode for the rule collections (sections, rules, versions) to avoid duplicates. You can undo an import.

**Card art.** The spreadsheet's `Illustration` column holds file names, not URLs. If you host the art somewhere, open the *Illustration* field in **Admin → Components → Fields & layout**, set its **URL template** (for example `https://example.com/art/{value}.jpg`) and place it on the card.

**Regenerating the file.** The import is built from [imports/blood-rage/rulebook.json](imports/blood-rage/rulebook.json) and the card spreadsheet:

```bash
node imports/build-blood-rage.mjs "Materials/Blood Rage Valhalla Data.xlsx"
```

## How it works

### Rule numbers and links

Sections and rules have no codes. A section's number (*5.3.1*) comes from its place in the section tree, and a rule's number (*5.3.1.2*) adds its place among the active rules of its section. Numbers are computed on the fly, so moving rules or sections renumbers them. Suggested rules have no number until they are approved.

Links point at a rule's document id, which never changes, so links, discussions and inbox notices survive renumbering. (Links from older versions of the site, which used codes such as `SUM.1`, still open the right rule.)

### Rulesets

- Each ruleset stores a map of `ruleId → versionId`. Rules that aren't in the map are *inactive*: they are hidden by default, or shown greyed out when "Show inactive" is on.
- If you browse to a version that isn't the one your ruleset uses, it is marked **Not in *ruleset***.
- The *Rulebook* ruleset is computed on the fly, so it always includes newly added rulebook text.

### Rule kinds

Kinds (Rule, Note, Tip, Changed from Blood Rage…) are a category badge and a filter. Admins manage the list, with a name and a color each, under **Admin → Rules → Rule kinds**, and set a rule's kind in its **Rule details** dialog. Rules store the kind's id, so renaming a kind updates every rule that uses it.

### Card versions

The component document is the printed card. Other versions store only the fields they change, and are shown merged over the printed data. A ruleset's `cards` map picks a version per card. The owner of a ruleset (or an admin) chooses it with **Use in …** in the card's details.

### Working together

All rule data, card versions, reactions and comments are live Firestore subscriptions. Components are cached, but every admin change bumps `config/componentsMeta`, which every open page watches and reloads on. Writes touch only what changed: ruleset saves update individual `entries.<ruleId>` keys, reactions update one user's key. Editors for component types, components and rule versions notice when someone else saved the same item and offer to load their version. Saving anyway asks first.

### Components at scale

- Each component is its own document, which keeps editing simple.
- To avoid every visitor downloading thousands of documents, every admin change bumps a counter in `config/componentsMeta`. Visitors cache all components in IndexedDB and download them again only when the counter changes. An unchanged visit costs a single read.
- The grid is virtualized, so only the rows on screen are rendered.

### Card layout

Cards are clean web cards, not replicas of the printed ones. Each component type has a layout made of **rows**, stacked top to bottom like blocks on a web page. Fields in a row sit side by side, and each field has a **share** of its row's width.

- **Rows** can *fill* the remaining height (long text fades out at the bottom), be *highlighted* with the accent color, or have a *line* above them.
- **Fields on the card** have a text size (XS–XL), alignment, bold, italic, subdued, capitals, an optional field name, and text before or after the value (for example `+` before a strength, or `[rage]` after a cost).
- All cards of a type share one shape (width ÷ height) and text scales with the card, so the grid stays uniform at any card size.
- An optional *Type* field picks the accent color per value, for example red for Battle cards and green for Quest cards.

Fields that are not on the card still appear in the component's details. In the editor, drag fields between rows or use the buttons under the selected field. The editor has its own undo for unsaved changes.

### Undo

Writes go through [src/lib/store.js](src/lib/store.js). While an action runs, every document it touches is read once before its first write. Undo restores whole documents for sets and deletes, and only the changed fields for updates, so a user's undo stays within what the security rules allow them to do. Undoing is recorded as well, which is how redo works. The history is kept per browser tab and cleared on sign-out.

### Backups

**Admin → Backup & import** exports any set of collections as one JSON file (`"format": "brv-backup"`, timestamps as `{"__ts": millis}`) and imports such files in *Merge* or *Replace* mode. Admins, user profiles and admin chat are left out of imports unless you tick them, and *Replace* never deletes your own admin entry.

### Field kinds

| Kind | Purpose |
| --- | --- |
| ID | Unique identifier, exactly one per type. Imports update existing rows by ID. |
| Title | The component's name. Doesn't need to be unique. |
| Type | Category, faction or god. Can be offered as a filter. |
| Image | External URL, or a value inserted into a URL template. |
| Ability | Gameplay text. HTML and `[shorthands]` are rendered. |
| Lore | Flavor text. |
| Value | A number such as a cost or strength. Sorts numerically. |
| State | Marks a component as an alternate state of another one (flipped, turned, upgraded…). Holds the other component's ID and a state name. Alternate states are hidden from the grid and reached with the state switcher in the card details. |

### Data model (Firestore)

| Collection | Contents |
| --- | --- |
| `sections` | `title`, `parent`, `order` |
| `rules` | `sectionId`, `order`, `title`, `kind`, `page`, `status` (`active` / `suggested` / `rejected`), `commentCount` |
| `versions` | `ruleId`, `label`, `text` (HTML), `note`, `reactions` {uid: `up` / `down` / `q`} |
| `comments` | `ruleId` or `componentId`, `versionId`, `text`, author, `reactions` |
| `rulesets` | `name`, `description`, `entries` {ruleId: versionId}, `cards` {componentId: versionId}, `ownerUid`, `visibility` |
| `componentTypes` | Field definitions, layout and colors |
| `components` | `typeId` and `data` {fieldKey: value}: the printed card |
| `componentVersions` | `componentId`, `label`, `data` (only the changed fields), `note`, `reactions` |
| `componentMeta` | `reactions` on a card's printed version |
| `config/site` | `defaultRulesetId`, `kinds` [{id, label, color}] |
| `config/shorthands` | `items` {keyword: {type, value}} |
| `config/componentsMeta` | `version` (cache counter) |
| `admins/{uid}` | Admin flag |
| `users/{uid}` | Public profile: chosen `name` and `avatar` ({glyph, color} or {photo}). Never an email address |
| `subscribers/{key}` | `uids` {uid: true} following `rule_<id>`, `component_<id>`, `ruleset_<id>` or `suggestions`, plus a `label` and `link` |
| `inbox/{uid}/items` | A user's notices: `type`, `title`, `text`, `link`, `actorUid`, `read`. Delivered by whoever caused the event (there is no server) |
| `usernames/{name}` | `uid` holding each (lowercased) username, so names are unique |
| `adminChat` | Admin messages |

## Development

```bash
npm run dev        # against your Firebase project
npm run demo       # against the in-browser fake
npm run build      # production build into dist/
```

Game content lives in [imports/](imports/), not in the app: the site itself is game-agnostic apart from its name and welcome text.
