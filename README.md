# Blood Rage Valhalla: Unofficial Living Rulebook

A community-maintained FAQ, rules-clarification and balancing hub for *Blood Rage: Valhalla*. It's a static site hosted on GitHub Pages, with Firebase handling sign-in and data.

- **Rules.** Every rule from the rulebook is a separate entry with a short permanent id such as `k7q2m`; versions are cited as `k7q2m.1`, `k7q2m.2`… The rules read like a book; clicking one shows its tools. Each rule can have several versions, labeled *Rulebook*, *Official Ruling*, *Community* or *Suggestion*. People can react 👍 👎 ❓ and discuss. Anyone signed in can write **homebrew**: their own version of any rule or card, or a rule of their own. Homebrew is private to its author and goes straight into their own ruleset. Sharing sends it to the admins (still private); they make it a public *Suggestion* with its own discussion, then accept it (as *Community* or *Official Ruling*, optionally straight into a public ruleset). Turned down at either step, it stays the author's private homebrew, with the reason, to change and share again. Rule text can include externally hosted images. The rules are searchable and can be filtered. The ruleset PDF holds its rules and all its cards: one or two rule pages per sheet, cards drawn from the card layout, edge to edge for cutting (Mini 41 × 63.5 mm, Poker 63 × 88 mm, or a custom size), or as a table, on Letter, A4 or custom paper.
- **Rulesets.** A ruleset picks which rules are active and which version of each rule is used. No ruleset is *the* rulebook, since rulebooks get editions: admins rename rulesets, label public ones *Official*, *Community* or *Experimental* (the picker groups them so), and pick the default, whatever its label. The content file comes with a public Official *Rulebook* ruleset as the default; **Admin → Rulesets → New from the printed rules** makes another (a new edition). Until the site has a public ruleset, readers see the printed rules. Signed-in users can save their own rulesets and share them by link.
- **Components.** A card browser with search, filters and sorting that stays fast with thousands of entries. Cards have versions (Printed, Official Ruling, Community, Suggestion), reactions and discussion just like rules, and a ruleset can pick which version of each card it uses. Editors add and edit components in place; admins define component types and their fields, arrange them on a simple card layout, and define `[shorthand]` icons.
- **Admin.** Staff chat, a suggestions queue, a discussions queue, sections, rule kinds and a rules table for bulk changes, ruleset publishing, component types and a components table, people and roles, and (for the owner) a JSON backup and import.
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

Demo mode swaps Firebase for an in-browser fake (`src/demo/`). Data is stored in your browser's localStorage, and security rules are not enforced. A fresh demo starts with the Blood Rage content from [imports/blood-rage-valhalla.json](imports/blood-rage-valhalla.json). To try the admin tools, sign in with the name **Admin** and claim ownership in **Admin → People**.

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

### 5. Make yourself the owner

1. Open the site, sign in and choose a username.
2. Copy your user ID from **Account → Technical: your user ID**. This is the only time anyone needs it: the panel disappears for everyone once the site has an owner.
3. In the Firebase console, open **Firestore**, create a collection named `admins`, and add a document whose **ID is your user ID**. It can have any field, for example `name: "Your name"`.
4. Reload the site and go to **Admin → People**. Choose **Make me the owner**. This works once: it records you in `config/owner`, and nobody can demote or restrict the owner from the site.

From then on, give other people roles in **Admin → People**. You find them by their username:

| Role | Can do |
| --- | --- |
| User | Read, react, comment, write and share homebrew, follow, save rulesets (everyone who signs in) |
| Editor | Everything about content: rules, versions, sections, kinds, rulesets, components, backups, staff chat |
| Admin | Everything an editor can, plus roles and restrictions for other people |
| Owner | Everything an admin can; can't be demoted or restricted from the site |

Table access (Admin → Rules → Table and the component tables) is a separate permission, off by default even for admins: tick **Tables** for an editor or admin. The owner always has it. *Who can do what* at the top of People explains every right.

Admins can also restrict a user or editor (not an admin) with **No sharing** (they can still write private homebrew, comment and react) or **Silenced** (read only), with a reason that user sees. Role and restriction changes can be undone and are listed in the moderation log. The security rules enforce all of this.

### 6. Load the content

Once you have claimed ownership (step 5), the simplest way is **Admin → Backup → Import**: choose [imports/blood-rage-valhalla.json](imports/blood-rage-valhalla.json) and import it. Alternatively, load it from your computer with the project's service-account key:

1. Firebase console → **Project settings → Service accounts → Generate new private key**. Keep the downloaded file private and never commit it.
2. Run:

   ```bash
   node imports/load-into-firestore.mjs path/to/service-account.json imports/blood-rage-valhalla.json
   ```

[imports/blood-rage-valhalla.json](imports/blood-rage-valhalla.json) contains:

- the rulebook, transcribed verbatim: 138 rules in 30 sections;
- a *Blood Rage: Valhalla cards* component type with a card layout, and the 132 cards from the card spreadsheet;
- the `[rage]`, `[axes]`, `[horns]` and `[tribute]` shorthands, shown as emoji (replace them with image URLs if you like).

Documents are written with merge and the file uses fixed ids, so running it again updates the same documents instead of adding duplicates. Nothing outside the file is deleted.

**Card art.** The spreadsheet's `Illustration` column holds file names, not URLs. If you host the art somewhere, open the *Illustration* field in **Admin → Components → Fields & layout**, set its **URL template** (for example `https://example.com/art/{value}.jpg`) and place it on the card.

**Regenerating the file.** It is built from [imports/blood-rage/rulebook.json](imports/blood-rage/rulebook.json) and the card spreadsheet:

```bash
node imports/build-blood-rage.mjs "Materials/Blood Rage Valhalla Data.xlsx"
```

**Test data.** [imports/test-data.json](imports/test-data.json) is the same content plus activity to test with: Official Rulings and Community versions (rules and cards), reactions, discussions (one handled), three rulesets (one public), follows, staff chat, and homebrew at every step (private, shared with the admins, turned down, public suggestion, accepted). It is credited to three existing accounts and holds no profiles or roles. Load it with **Admin → Backup → Import → Replace**; rebuild it with `node imports/build-test-data.mjs`.

## How it works

### Rule ids

Each rule has a short id such as `k7q2m`, derived from its permanent Firestore document id (a hash in a 31-character alphabet without look-alike characters). Nobody chooses or stores it, existing rules get one automatically, and it never changes when rules or sections move. In the unlikely event two rules hash alike, the newer one gets a longer id.

Versions are numbered after the id in the order they were added (`k7q2m.1`, `k7q2m.2`). New versions store their number (`n`), so deleting one never renumbers the others.

Links use the id (`#/rules/k7q2m`, or `#/rules/k7q2m.2` for a version). Older links with a document id or a section code (`SUM.1`) still open the right rule. Section numbers (*5.3.1*) are positional and only used as headings.

### Rulesets

- Each ruleset stores a map of `ruleId → versionId`. Rules that aren't in the map are *inactive*: they are hidden by default, or shown greyed out when "Show inactive" is on.
- If you browse to a version that isn't the one your ruleset uses, it is marked **Not in *ruleset***.
- The *Rulebook* ruleset is computed on the fly, so it always includes newly added rulebook text.

### Rule kinds

Kinds (Rule, Note, Tip, Changed from Blood Rage…) are a category badge and a filter. Admins manage the list, with a name and a color each, under **Admin → Rules → Kinds**, and set a rule's kind in its **Rule details** dialog. Rules store the kind's id, so renaming a kind updates every rule that uses it.

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

**Admin → Backup** (owner only) downloads any set of collections as one JSON file (`"format": "brv-backup"`, timestamps as `{"__ts": millis}`) and imports one. *Merge* writes the file's documents; *Replace* makes the ticked collections match the file, emptying ticked collections the file lacks, for a clean start. People (admins, profiles, usernames, roles, moderation log) are unticked by default, and the owner's own owner, admin, role and profile entries are never touched. Imports are one undoable action in that tab. Personal notices (`inbox`) are not included. The security rules let only the owner (`config/owner`) do this. `imports/load-into-firestore.mjs` still loads a file with a service-account key (see setup step 6).

## Field kinds

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
| `rules` | `sectionId`, `order`, `title`, `kind`, `page`, `status` (`active` / `suggested` / `rejected`), `commentCount`, and `homebrewId` for a shared homebrew rule |
| `versions` | `ruleId`, `label`, `text` (HTML), `n` (version number), `note`, `reactions` {uid: `up` / `down` / `q`}, and `homebrewId` for shared homebrew |
| `homebrew` | Private to its `ownerUid`: `kind` (`version` {ruleId, text} / `rule` {sectionId, title, text} / `card` {componentId, typeId, data}), `note`, `submitted` (shared with the admins, who can then list it), `sharedId` (its public suggestion, once the admins made one), `declineReason` once turned down. Rulesets refer to it as `hb:<id>`. In the backup (the owner can read it all) |
| `comments` | `ruleId` or `componentId`, `versionId`, `text`, author, `reactions`, and `handled` once staff have dealt with it in the discussions queue |
| `rulesets` | `name`, `description`, `entries` {ruleId: versionId}, `cards` {componentId: versionId} (a homebrew is `hb:<id>`), `ownerUid`, `visibility`, and `label` (`Official` / `Community` / `Experimental`, set by staff) |
| `componentTypes` | Field definitions, layout and colors |
| `components` | `typeId` and `data` {fieldKey: value}: the printed card |
| `componentVersions` | `componentId`, `label`, `data` (only the changed fields), `note`, `reactions`, and `homebrewId` for shared homebrew |
| `componentMeta` | `reactions` on a card's printed version |
| `componentRules` | `rules` [ruleId, …]: the rules attached to a card, shown beside it in its details |
| `config/site` | `defaultRulesetId`, `kinds` [{id, label, color}] |
| `config/shorthands` | `items` {keyword: {type, value}} |
| `config/componentsMeta` | `version` (cache counter) |
| `config/owner` | `uid` of the owner. Created once from the site, changed only in the Firebase console |
| `roles/{uid}` | `role` (`editor` / `admin`), `block` (`suggest` / `silence`) and `reason`. Written by admins |
| `modlog` | Role and restriction changes: who, whom, from, to, reason |
| `admins/{uid}` | The original admin list, still honored as admin |
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
