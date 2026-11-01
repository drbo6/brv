# Blood Rage Valhalla: Unofficial Living Rulebook

A community-maintained FAQ, rules-clarification and balancing hub for *Blood Rage: Valhalla*. It's a static site hosted on GitHub Pages, with Firebase handling sign-in and data.

- **Rules.** Every rule from the rulebook is a separate entry with a stable ID such as `SUM.1`. Each rule can have several versions, labeled *Rulebook*, *Official Ruling*, *Community* or *Suggestion*. People can react 👍 👎 ❓, discuss, and suggest new rules or new wording. The rules are searchable, can be filtered, and can be exported to PDF.
- **Rulesets.** A ruleset picks which rules are active and which version of each rule is used. The built-in *Rulebook* ruleset always uses the printed text. Signed-in users can save their own rulesets and share them by link. Admins choose which rulesets are public and which one is the default.
- **Components.** A card browser with search, filters and sorting that stays fast with thousands of entries. Admins define component types and their fields, lay out the card visually, import spreadsheets, and define `[shorthand]` icons.
- **Admin.** Admin chat, a suggestions queue, section management, ruleset publishing, component management and the admin list.

This is an unofficial fan project and is not affiliated with the game's publishers.

## Try it without Firebase

```bash
npm install
npm run demo
```

Demo mode swaps Firebase for an in-browser fake (`src/demo/`). Data is stored in your browser's localStorage, and security rules are not enforced. To try the admin tools, sign in with the name **Admin**. Then go to **Admin → Rules → Import transcribed rulebook**, and to **Admin → Components → Add Blood Rage card type → Import spreadsheet**.

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

- **Rules.** Go to **Admin → Rules → Import transcribed rulebook**. This adds 138 rules in 30 sections, transcribed verbatim from the rulebook. Run it once.
- **Cards.** Go to **Admin → Components** and choose **Add Blood Rage card type**. Then use **Import spreadsheet** with the card `.xlsx`. The preset's fields match the spreadsheet's columns, so they map automatically.
- **Icons.** Under **Shorthands**, choose **Add Blood Rage icons** and then **Save**. This makes `[rage]`, `[axes]`, `[horns]` and `[tribute]` render as emoji. You can replace these with image URLs.
- **Card art.** The spreadsheet's `Illustration` column holds file names, not URLs. If you host the art somewhere, open the *Illustration* field in **Fields & layout** and set its **URL template**, for example `https://example.com/art/{value}.jpg`.

## How it works

### Rule IDs

Rule IDs look like `SECTION.n`, for example `SUM.1`, `CON.4` or `QRF.3`. The ID is stored separately from the rule's position. Moving a rule, reordering sections or renaming a section never changes existing IDs, so links and discussions stay valid. Section numbers such as *5.3.1* are computed from the current order and are only used for display.

New rules get the next free number in their section. A rule added between `SUM.2` and `SUM.3` might be `SUM.5`. Admins can edit any ID if they want to renumber.

Suggested rules from the community get a temporary `SUG-XXXX` ID until an admin approves them.

### Rulesets

- Each ruleset stores a map of `ruleId → versionId`. Rules that aren't in the map are *inactive*: they are hidden by default, or shown greyed out when "Show inactive" is on.
- If you browse to a version that isn't the one your ruleset uses, it is marked **Not in *ruleset***.
- The *Rulebook* ruleset is computed on the fly, so it always includes newly added rulebook text.

### Components at scale

- Each component is its own document, which keeps editing simple.
- To avoid every visitor downloading thousands of documents, every admin change bumps a counter in `config/componentsMeta`. Visitors cache all components in IndexedDB and download them again only when the counter changes. An unchanged visit costs a single read.
- The grid is virtualized, so only the rows on screen are rendered.

### Card layout

- Each component type has a grid of columns × rows (20 × 30 for the Blood Rage cards). Every field sits in a rectangle on that grid, with a layer order.
- Font sizes are relative to the card's width, so the same layout works at any card size.
- Field styling covers font, alignment, rotation, shapes (circle or ring badges), backgrounds, and prefixes or suffixes (for example `+` before a strength value).
- A *Type* field can set the card's color. The Blood Rage preset uses this to make Battle cards red and Quest cards green.

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
| `sections` | `code`, `title`, `parent`, `order` |
| `rules` | `code`, `sectionId`, `order`, `title`, `kind`, `page`, `status` (`active` / `suggested` / `rejected`), `commentCount` |
| `versions` | `ruleId`, `label`, `text` (HTML), `note`, `reactions` {uid: `up` / `down` / `q`} |
| `comments` | `ruleId`, `versionId`, `text`, author, `reactions` |
| `rulesets` | `name`, `description`, `entries` {ruleId: versionId}, `ownerUid`, `visibility` |
| `componentTypes` | Field definitions, layout and colors |
| `components` | `typeId` and `data` {fieldKey: value} |
| `config/site` | `defaultRulesetId` |
| `config/shorthands` | `items` {keyword: {type, value}} |
| `config/componentsMeta` | `version` (cache counter) |
| `admins/{uid}` | Admin flag |
| `users/{uid}` | Display name and photo |
| `adminChat` | Admin messages |

**Backups:** use **Admin → Rules → Download JSON backup**.

## Development

```bash
npm run dev        # against your Firebase project
npm run demo       # against the in-browser fake
npm run build      # production build into dist/
```

The rulebook transcription lives in [src/data/rulebook-seed.json](src/data/rulebook-seed.json).
