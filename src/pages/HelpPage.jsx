import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/ui.jsx';
import { useSession } from '../lib/session.jsx';
import '../help.css';

const Tip = ({ children }) => (
  <aside className="help-tip">
    <Icon name="bulb" />
    <div>{children}</div>
  </aside>
);

const Keys = ({ k }) => (
  <span className="help-keys">
    {k.split('+').map((x, i) => (
      <span key={i}>
        {i > 0 && '+'}
        <kbd>{x}</kbd>
      </span>
    ))}
  </span>
);

// Who each topic is for. Readers see the parts for their role and below (View as included).
const PARTS = [
  { id: 'visitor', title: 'Reading the site', who: 'visitors' },
  { id: 'member', title: 'For members', who: 'members' },
  { id: 'editor', title: 'For editors', who: 'editors' },
  { id: 'admin', title: 'For admins', who: 'admins' },
];
const LEVEL = { visitor: 0, user: 1, editor: 2, admin: 3, owner: 3 };

const TOPICS = [
  {
    id: 'about',
    for: 'visitor',
    title: 'What this site is',
    icon: 'info',
    body: (
      <>
        <p>
          <b>Blood Rage: Valhalla</b> is a great game, but its rulebook leaves some questions open. This site is an unofficial, community-maintained living rulebook: every rule from
          the book, plus official rulings, community clarifications and suggested balance changes, all in one searchable place.
        </p>
        <ul>
          <li>
            <b>Visitors</b> can read everything: rules, versions, discussions, rulesets and cards.
          </li>
          <li>
            <b>Signed-in members</b> can react, discuss, write their own homebrew, share it with the admins and save their own rulesets.
          </li>
          <li>
            <b>Admins</b> curate the content: they review shared homebrew, publish rulesets, manage cards and keep backups.
          </li>
        </ul>
        <p className="muted small">This is a fan project and is not affiliated with the game's publishers.</p>
      </>
    ),
  },
  {
    id: 'reading',
    for: 'visitor',
    title: 'Reading the rules',
    icon: 'book',
    body: (
      <>
        <p>The Rules page reads like a book. Each rule shows its ID, title and text; nothing else gets in the way.</p>
        <ul>
          <li>
            <b>Click a rule</b> (its text or title) to open its tools: versions, reactions, discussion, homebrew and the link button. Click again to close it. One rule is open at a
            time.
          </li>
          <li>
            <b>Rule ids</b> like <code>k7q2m</code> are short, permanent and unique: they never change, however rules and sections are moved, so they are safe to cite.
            Versions are numbered after the id in the order they were added: <code>k7q2m.1</code> is usually the rulebook text, <code>k7q2m.2</code> the next version.
            Section numbers such as <i>5.3.1</i> only show where you are in the book.
          </li>
          <li>
            <b>Copy link</b> <Icon name="link" size={14} /> gives a direct link that opens the site on that rule.
          </li>
          <li>
            <b>Search</b> looks through IDs, titles and the text of every version.
          </li>
          <li>
            <b>Filters</b> narrow the list by version label (for example "Has an Official Ruling") or by kind.
          </li>
          <li>
            <b>Show inactive</b> also lists rules that are not part of the current ruleset, greyed out, and suggested new rules.
          </li>
          <li>
            The <b>Contents</b> list beside the rules jumps to any section. On phones it is the <i>Jump to section</i> menu in the search bar.
          </li>
          <li>
            <b>PDF</b> <Icon name="download" size={14} /> in the ruleset bar downloads the active ruleset: its rules in the versions it uses, then all its cards. You choose
            Letter, A4 or a custom paper size, one or two rule pages per sheet, and whether the cards appear as cards (in a size you pick), as a table, or not at all. Cards the ruleset plays in
            another version are marked. Images in rules appear as <i>[Image: description]</i>.
          </li>
        </ul>
        <Tip>Small hints next to a closed rule tell you when it has more versions or comments, so you know where the discussion is.</Tip>
      </>
    ),
  },
  {
    id: 'versions',
    for: 'visitor',
    title: 'Versions and labels',
    icon: 'layers',
    body: (
      <>
        <p>A rule can have several versions. Open a rule and use the arrows to step through them. Each version carries a label:</p>
        <dl className="help-defs">
          <dt>
            <span className="label l-rulebook">Rulebook</span>
          </dt>
          <dd>The text exactly as printed, with its page number.</dd>
          <dt>
            <span className="label l-official">Official Ruling</span>
          </dt>
          <dd>A clarification from the designers or publisher.</dd>
          <dt>
            <span className="label l-community">Community</span>
          </dt>
          <dd>A clarification or balance change the community has agreed on.</dd>
          <dt>
            <span className="label l-suggestion">Suggestion</span>
          </dt>
          <dd>A member's homebrew that the admins put up for everyone: open for reactions and its own discussion while admins decide.</dd>
          <dt>
            <span className="label l-homebrew">Homebrew</span>
          </dt>
          <dd>Your own private version. Only you see it.</dd>
        </dl>
        <p>
          The version you see first is the one your ruleset uses. If you browse to another one, it is tagged <span className="tag t-warn">Not in …</span> so you always know which
          text applies at your table.
        </p>
      </>
    ),
  },
  {
    id: 'kinds',
    for: 'visitor',
    title: 'Rule kinds',
    icon: 'grid',
    body: (
      <>
        <p>
          Every rule has a <b>kind</b>: a small colored badge such as <i>Rule</i>, <i>Note</i>, <i>Changed from Blood Rage</i>, <i>Tip</i>, <i>Example</i>, <i>Flavor</i> or{' '}
          <i>Quick reference</i>. Kinds are only a category: they help readers skim and can be used as a filter. They don't change how a rule works.
        </p>
        <ul>
          <li>
            Admins manage the list of kinds (name and color) in <b>Admin → Rules → Kinds</b>.
          </li>
          <li>
            The kind of a rule is set in its <b>Rule details</b> dialog: open the rule and choose <i>Rule details</i> in the Admin row.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'reactions',
    for: 'member',
    title: 'Reactions and discussion',
    icon: 'message',
    body: (
      <>
        <p>Signed-in members can react to each version:</p>
        <ul>
          <li>👍 Agree: this wording is right or this change is good.</li>
          <li>👎 Disagree.</li>
          <li>❓ Unclear: this still leaves questions.</li>
        </ul>
        <p>
          Reactions belong to a version, not the whole rule: agreeing with the printed text says nothing about a community rewrite. Click your reaction again to take it back. Hover over a reaction to see who chose it.
        </p>
        <p>
          <b>Discuss</b> opens the comment thread. Each comment remembers which version its author was looking at, so later readers know what was being discussed. You can edit or
          delete your own comments, and react to others'.
        </p>
      </>
    ),
  },
  {
    id: 'homebrew',
    for: 'member',
    title: 'Homebrew and sharing',
    icon: 'flask',
    body: (
      <>
        <p>Play it your way: change any rule or card, or write a rule of your own. It starts out private, and you decide whether to share it.</p>
        <ol>
          <li>
            <b>Homebrew</b> <Icon name="flask" size={14} /> on an open rule (or in a card's details) writes your own version, starting from the text on screen.{' '}
            <b>Add homebrew rule</b> in the toolbar adds a new rule to one of the rulebook's sections. Your homebrew is labeled{' '}
            <span className="label l-homebrew">Homebrew</span> and <b>only you see it</b>. It goes straight into the ruleset you are using, which must be one of your own
            (you are asked to switch, or make your own copy, if it isn't); it prints in your PDF too.
          </li>
          <li>
            <b>Share</b> sends it to the admins. Only you and they see it at this point.
          </li>
          <li>
            The admins make it a public <span className="label l-suggestion">Suggestion</span>, credited to you, with <b>its own discussion</b>, where everyone can react and
            say what they think, for example that it should become the default.
          </li>
          <li>
            Admins then <b>accept</b> the suggestion as a <i>Community</i> version or <i>Official Ruling</i>, sometimes straight into a public ruleset.
          </li>
        </ol>
        <p>
          You can keep editing it, and <b>Withdraw</b> it, at any point while it is under review. If the admins <b>turn it down</b> at either step, it stays your private
          homebrew, with their reason: you can still play it, change it and <b>Share again</b>. You get a notice at every step.
        </p>
        <p>
          Would you like a <i>Rulebook</i>, <i>Official Ruling</i> or <i>Community</i> version changed for everyone? Say so with <b>Discuss</b> on that rule or card, or write
          your change as homebrew and share it with the admins.
        </p>
        <p>
          Your homebrew is listed under <b>Account → My homebrew</b>. A ruleset that uses private homebrew works for you, but others opening its link see it without your
          homebrew until the admins make it a public suggestion; copying the link offers to share it with them first.
        </p>
        <h4>The text editor</h4>
        <p>
          Type plain text: blank lines become paragraphs. The toolbar adds <b>bold</b>, <i>italic</i>, bulleted lists and links. <b>Image</b> <Icon name="image" size={14} />{' '}
          inserts a picture hosted elsewhere (Imgur, BoardGameGeek, a public cloud link…): paste its <code>https://</code> address, describe it for screen readers and optionally add
          a caption. Use <b>Preview</b> to check the result. Shorthands such as <code>[rage]</code> turn into icons.
        </p>
      </>
    ),
  },
  {
    id: 'rulesets',
    for: 'visitor',
    title: 'Rulesets',
    icon: 'layers',
    body: (
      <>
        <p>
          A ruleset decides which rules are active and which version of each rule (and of each card) applies. No ruleset is <i>the</i> rulebook, since rulebooks get
          editions too: public rulesets are labeled <span className="tag t-official">Official</span>, <span className="tag t-community">Community</span> or{' '}
          <span className="tag t-warn">Experimental</span>, and the site opens on the one admins chose as the default.
        </p>
        <ul>
          <li>
            The <b>ruleset bar</b> under the header, on the Rules and Components pages, shows the ruleset you are using. Pick another one there; your choice is remembered on
            this device. The same ruleset decides both the rules and the cards you see.
          </li>
          <li>
            Changing a ruleset never changes the rules themselves, or anyone else's view. In an open rule or card, the <b>Your ruleset</b> row says what the ruleset does with
            the version on screen and offers <i>Use this version</i>, <i>Add</i> or <i>Leave out</i>. On a ruleset that isn't yours (such as the printed rulebook) this starts
            <b>your own copy</b>; on your own ruleset it changes that one.
          </li>
          <li>
            Changes stay unsaved until you choose: the ruleset bar turns amber and offers Undo, Redo, <b>Discard</b>, <b>Save</b> (your own rulesets) and{' '}
            <b>Save as new…</b>. <b>Customize</b> (Rules page) puts an <i>In ruleset</i> switch on every rule for bigger changes.
          </li>
          <li>
            Just stepping to another version of a rule shows a note under the search bar, because the page no longer shows the ruleset as it is. From there you can jump to
            those rules, use those versions, or go back to the ruleset's versions.
          </li>
          <li>
            Share a ruleset with the link button <Icon name="link" size={14} />. New rulesets are private but anyone with the link can view them.
          </li>
          <li>
            Admins can make a ruleset public, rename it, label it Official, Community or Experimental, and choose the site's default ruleset (whatever its label). Rulesets
            themselves are always made here, on the Rules page: a new edition is a ruleset like any other.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'components',
    for: 'visitor',
    title: 'Components and cards',
    icon: 'grid',
    body: (
      <>
        <p>The Components page shows every component (cards and anything else the site tracks) together, as tidy cards.</p>
        <ul>
          <li>
            <b>Search</b> everything, or narrow it with the <b>type</b> filter. With one type chosen, its own filters (god, kind…) and sort options appear. Change the{' '}
            <b>card size</b> with the slider.
          </li>
          <li>
            Click a card for its <b>details</b>: the card itself, the <b>rules for this card</b> (rules staff attached because they explain or clarify it, each in the version
            your ruleset uses), its versions, reactions and discussion.
          </li>
          <li>
            A <b>⟲</b> badge means the card has alternate states (flipped, upgraded…). Switch between them in the details.
          </li>
        </ul>
        <h4>Versions, reactions and discussion</h4>
        <p>
          Cards work just like rules. Each card can have versions: the <span className="label l-rulebook">Printed</span> card plus <i>Official Ruling</i>, <i>Community</i> and{' '}
          <i>Suggestion</i> versions. React 👍 👎 ❓, discuss, and use <b>Homebrew</b> in the card details to play it with your own values (see Homebrew and sharing). The selected ruleset decides which version of
          each card is shown.
        </p>
        <h4>For editors</h4>
        <p>
          Editors work on cards right where they read them, like rules: <b>Add</b> in the toolbar creates a card, and a card's details have <b>Edit card</b> and{' '}
          <b>Delete card</b>. <b>Attach rule</b> in the details links a rule to the card, so it is shown beside the card; reorder or detach them with the arrows and ×. Card
          types, fields and layout stay in Admin → Components.
        </p>
      </>
    ),
  },
  {
    id: 'undo',
    for: 'member',
    title: 'Undo and redo',
    icon: 'undo',
    body: (
      <>
        <p>Every change you save can be undone, from reactions to deleting a rule or changing many rules at once in the rules table.</p>
        <ul>
          <li>
            The confirmation message after an action has an <b>Undo</b> button.
          </li>
          <li>
            The <Icon name="undo" size={14} /> and <Icon name="redo" size={14} /> buttons in the header undo and redo your latest changes. Hover them to see what they will undo.
          </li>
          <li>
            Keyboard: <Keys k="Ctrl+Z" /> to undo, <Keys k="Ctrl+Shift+Z" /> or <Keys k="Ctrl+Y" /> to redo (<kbd>⌘</kbd> on a Mac).
          </li>
          <li>Editors with unsaved changes, like customizing a ruleset or the card layout editor, have their own undo; the keyboard shortcuts use it first.</li>
          <li>While you type in a text box, the browser's normal text undo applies.</li>
        </ul>
        <Tip>
          The history belongs to this browser tab and is cleared when you sign out. Rarely, an undo is refused because your permissions no longer allow it, for example after someone
          else deleted the same item.
        </Tip>
      </>
    ),
  },
  {
    id: 'together',
    for: 'member',
    title: 'Working together',
    icon: 'user',
    body: (
      <>
        <ul>
          <li>Everything updates live: new rules, versions, reactions, comments and card edits appear for everyone without reloading.</li>
          <li>Changes are saved field by field, so two people editing different parts of the same thing don't overwrite each other.</li>
          <li>
            If someone else changes what you are editing, you get a warning and can choose to <b>Load their version</b> or keep yours. If you save anyway, you are asked first, because it replaces their changes.
          </li>
        </ul>
        <p>Admins can coordinate in the Admin chat.</p>
      </>
    ),
  },
  {
    id: 'inbox',
    for: 'member',
    title: 'Inbox and following',
    icon: 'bell',
    body: (
      <ul>
        <li>
          <b>Follow</b> a rule (in its tools), a card (in its details) or a ruleset (in the ruleset bar). You then get a notice in your <b>Inbox</b> when someone comments,
          adds or changes a version, or updates the ruleset.
        </li>
        <li>Commenting on something or sharing a homebrew of it follows it automatically, so you hear about replies. You always hear when the admins make your shared homebrew a suggestion, accept it or turn it down.</li>
        <li>
          The bell in the header shows how many notices are unread. In the Inbox you can open a notice, mark notices read or unread, and clear old ones. The <b>Following</b> tab
          lists everything you follow, with an Unfollow button.
        </li>
        <li>On the Rules page, the ruleset and search bars stay pinned at the top while you scroll. The pin button at the end of the search bar turns that off.</li>
      </ul>
    ),
  },
  {
    id: 'view-as',
    for: 'member',
    title: 'View as',
    icon: 'eye',
    body: (
      <>
        <p>
          The <Icon name="eye" size={14} /> menu in the header shows the site as someone with less access: admins can preview it as a <i>signed-in user</i> or a <i>visitor</i>, and
          members as a <i>visitor</i>. A banner reminds you that you are previewing; <b>Stop previewing</b> returns to your own view.
        </p>
        <p className="muted">The preview only lasts for the current tab, so reloading or opening a new tab never locks an admin out of the admin tools.</p>
      </>
    ),
  },
  {
    id: 'theme',
    for: 'visitor',
    title: 'Light and dark mode',
    icon: 'info',
    body: <p>The site follows your device's light or dark setting. Use the theme toggle in the header to switch manually; your choice is remembered on this device.</p>,
  },
  {
    id: 'account',
    for: 'visitor',
    title: 'Your account',
    icon: 'user',
    body: (
      <ul>
        <li>
          Sign in with Google from the <b>Account</b> page. The first time, you choose a <b>username</b> (unique, 3–24 characters) and an <b>avatar</b>: an emoji on a
          color (you are offered a random selection of emoji nobody else uses), a picture from any https address, or your Google picture.
        </li>
        <li>
          Your email address and Google name are private: they are never shown to anyone or stored with your posts. Change your username or avatar any time with{' '}
          <b>Edit profile</b>; your comments and suggestions show the new name.
        </li>
        <li>The Account page lists your rulesets: open, rename, share or delete them.</li>
        <li>
          It also shows your role, and any restriction an admin has put on your account with the reason. To get a role, ask an admin: they find you by your username.
        </li>
      </ul>
    ),
  },
  {
    id: 'admin',
    for: 'editor',
    title: 'Staff guide',
    icon: 'shield',
    body: (
      <>
        <p>
          Staff see an Admin tab. <b>Editors</b> manage all content: everything below except People. <b>Admins</b> also manage people. The <b>owner</b> is an admin who
          can't be demoted or restricted.
        </p>
        <h4>Staff chat</h4>
        <p>A private chat for editors and admins. Enter sends, Shift+Enter starts a new line.</p>
        <h4>Suggestions</h4>
        <p>
          Two steps, with the count of waiting items on the tab. <b>Shared with the admins</b> lists homebrew members sent you; nobody else sees it yet. Check it, then{' '}
          <b>Make it a public suggestion</b> (public, credited to its author, with its own discussion) or <b>Turn down</b> with a reason. <b>Public suggestions</b> lists those
          everyone can discuss: <b>Accept</b> one as <i>Community</i> or <i>Official Ruling</i> (a new rule becomes active), optionally using it in a public ruleset right
          away, or <b>Turn down</b> with a reason. Turned down, it goes back to its author as private homebrew, which they can change and share again. The author is told at
          every step. Follow the feed to get a notice whenever something is shared. Making a ruleset public warns you if it relies on someone's private homebrew.
        </p>
        <h4>Discussions</h4>
        <p>
          The newest comments on all rules and cards, newest first, with the rule or card each one is about and the number still open on the tab. Mark a comment{' '}
          <b>Handled</b> once it has been read or answered (or <i>Mark all handled</i>), reopen it if needed, open the rule or card to reply there, or delete it.{' '}
          <i>All</i> shows handled comments too.
        </p>
        <h4>Rules</h4>
        <ul>
          <li>
            <b>Sections:</b> add sections, rename them, nest them and reorder them. Section numbers follow the new order; rule ids never change.
          </li>
          <li>
            <b>Kinds</b> (tab): the list of kinds with their name and color.
          </li>
          <li>On the Rules page, an open rule has an Admin row: edit or delete the version, edit rule details (section, kind, page, status), move it, approve it or delete it.</li>
          <li>
            <b>Table</b> (a tab in Admin → Rules): every rule in a sortable, filterable table. Change a rule's section, kind, status, page or title in place, or tick several
            rules and change them together. <i>Columns</i> chooses what is shown. The <b>Edit</b> button on a row opens the whole rule: its details and every version,
            each editable, plus adding or deleting versions and deleting the rule.
          </li>
        </ul>
        <h4>Rulesets</h4>
        <p>Make rulesets public or private and choose the site default that new visitors see.</p>
      </>
    ),
  },
  {
    id: 'admin-components',
    for: 'editor',
    title: 'Managing components',
    icon: 'grid',
    body: (
      <>
        <p>
          Single cards are added and edited on the Components page itself. <b>Admin → Components</b> is for structure and bulk work: pick a component type (or create one)
          and use its two tabs:
        </p>
        <ol>
          <li>
            <b>Fields &amp; layout:</b> the type's fields and how its card looks.
          </li>
          <li>
            <b>Table:</b> all components of that type in a sortable table, for bulk work: search, edit, add or delete, and use <i>Columns</i> to choose which fields are shown.
          </li>
        </ol>
        <h4>Field kinds</h4>
        <table className="help-table">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Use it for</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>ID</td>
              <td>The unique identifier. Exactly one per type; imports update components with the same ID.</td>
            </tr>
            <tr>
              <td>Title</td>
              <td>The component's name. Doesn't need to be unique.</td>
            </tr>
            <tr>
              <td>Type</td>
              <td>A category such as type, faction or god. Can be offered as a filter and can set the card's accent color.</td>
            </tr>
            <tr>
              <td>Image</td>
              <td>An external image URL, or a value inserted into a URL template.</td>
            </tr>
            <tr>
              <td>Ability</td>
              <td>Gameplay text. HTML and shorthands are rendered.</td>
            </tr>
            <tr>
              <td>Lore</td>
              <td>Flavor text without gameplay effect.</td>
            </tr>
            <tr>
              <td>Value</td>
              <td>A number such as a cost or strength. Sorts numerically.</td>
            </tr>
            <tr>
              <td>State</td>
              <td>Marks a component as an alternate state (flipped, upgraded…) of another one, with a state name.</td>
            </tr>
          </tbody>
        </table>
        <h4>Card layout</h4>
        <ul>
          <li>A card is a stack of <b>rows</b>. Fields in a row sit side by side; each field has a <b>share</b> of the row's width.</li>
          <li>
            Rows can <b>Fill</b> the remaining height (long text fades out), be <b>Highlighted</b> in the accent color, or have a <b>Line</b> above them.
          </li>
          <li>
            Each field on the card has a text size from XS to XXL, alignment, bold, italic, subdued, capitals, an optional field name, and text before or after the value (for example{' '}
            <code>+</code> before a strength or <code>[rage]</code> after a cost).
          </li>
          <li>
            <b>Adding a field to the card:</b> use <i>Add to card</i> in the layout panel or the field list, or drag the field onto the card. New fields are placed on the card
            automatically. <i>Hide from card</i> takes a field off again; it still appears in the details.
          </li>
          <li>The card shape (width ÷ height) is shared by all cards of the type, and text scales with the card size.</li>
          <li>The accent color can come from a Type field, for example red Battle cards and green Quest cards.</li>
        </ul>
        <h4>Shorthands</h4>
        <p>
          Shorthands turn <code>[keyword]</code> in any card or rule text into an emoji or a small image. Define them in Admin → Components → Shorthands.
        </p>
      </>
    ),
  },
  {
    id: 'admin-data',
    for: 'admin',
    title: 'People and backups',
    icon: 'database',
    body: (
      <>
        <h4>People</h4>
        <p>
          Admins only. Everyone who has chosen a username is listed; find people by name, or show only staff or restricted users. <i>Who can do what</i> at the top
          explains every right. For each person choose a <b>role</b> (User, Editor, Admin), whether they get the bulk <b>Tables</b> (off by default, also for admins),
          and, for users and editors, a <b>restriction</b>: <i>No sharing</i> (they can still write private homebrew, comment and react) or <i>Silenced</i> (read only), with a reason they will
          see. Admins can't be restricted. Changes can be undone and are listed in the <b>moderation log</b>. If the site has no owner yet, an admin from the original setup can
          claim it here once.
        </p>
        <h4>Backup</h4>
        <p>
          Owner only. Downloads any set of collections as one JSON file; keep regular backups somewhere safe. <b>Import</b> loads such a file, or the prepared Blood Rage
          content in <code>imports/</code>. <i>Merge</i> adds and overwrites documents; <i>Replace</i> makes the ticked collections match the file and empties ticked
          collections the file doesn't have, which gives a clean start. People (admins, profiles, usernames, roles and the moderation log) are only touched when you tick them, and your own owner,
          admin, role and profile entries are always kept. Replacing asks you to type REPLACE; download a backup first.
        </p>
      </>
    ),
  },
  {
    id: 'shortcuts',
    for: 'visitor',
    title: 'Keyboard shortcuts',
    icon: 'edit',
    body: (
      <table className="help-table">
        <tbody>
          <tr>
            <td>
              <Keys k="Ctrl+Z" />
            </td>
            <td>Undo</td>
          </tr>
          <tr>
            <td>
              <Keys k="Ctrl+Shift+Z" /> or <Keys k="Ctrl+Y" />
            </td>
            <td>Redo</td>
          </tr>
          <tr>
            <td>
              <kbd>Esc</kbd>
            </td>
            <td>Close a dialog</td>
          </tr>
          <tr>
            <td>
              <kbd>Enter</kbd>
            </td>
            <td>Confirm a dialog</td>
          </tr>
          <tr>
            <td>
              <kbd>Tab</kbd>
            </td>
            <td>Move between controls; every action can be reached without a mouse</td>
          </tr>
        </tbody>
      </table>
    ),
  },
  {
    id: 'faq',
    for: 'visitor',
    title: 'Questions',
    icon: 'search',
    body: (
      <dl className="help-faq">
        <dt>Why can't I see a rule?</dt>
        <dd>It may not be part of the current ruleset (turn on Show inactive), or a search or filter hides it.</dd>
        <dt>How do I cite a rule?</dt>
        <dd>
          Use its id, for example <code>k7q2m</code>, or <code>k7q2m.2</code> for a specific version. Typing an id in the search box finds the rule, and the link
          button copies a link (to the exact version you are looking at, if it isn't the one your ruleset uses).
        </dd>
        <dt>Who can change what?</dt>
        <dd>
          Visitors read. Signed-in members react, comment, write homebrew versions of rules and cards and homebrew rules of their own, share them with the admins, and save their own
          rulesets. They can't change sections, kinds or other structure. Editors and admins change everything else.
        </dd>
        <dt>My change disappeared. Can I get it back?</dt>
        <dd>If you made it in this tab, use Undo. Admins can also restore content from a backup.</dd>
        <dt>Is this official?</dt>
        <dd>No. Official rulings are marked as such, but the site itself is run by fans.</dd>
      </dl>
    ),
  },
];

export default function HelpPage({ route }) {
  const { role } = useSession();
  const level = LEVEL[role] ?? 0;
  const parts = PARTS.slice(0, level + 1).map((p) => ({ ...p, topics: TOPICS.filter((t) => t.for === p.id) }));
  const [tocOpen] = useState(() => window.matchMedia('(min-width: 901px)').matches);
  const jumped = useRef(null);
  const topic = route?.parts?.[0];

  const go = (id) => document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  useEffect(() => {
    if (!topic || jumped.current === topic) return;
    jumped.current = topic;
    document.getElementById(`help-${topic}`)?.scrollIntoView({ block: 'start' });
  }, [topic]);

  return (
    <div className="help-layout">
      <aside className="help-toc" aria-label="Help topics">
        <details open={tocOpen}>
          <summary>Topics</summary>
          <nav>
            {parts.map((p) => (
              <div key={p.id} className="help-toc-part">
                {parts.length > 1 && <p className="help-toc-title">{p.title}</p>}
                {p.topics.map((t) => (
                  <a
                    key={t.id}
                    href={`#/help/${t.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      go(t.id);
                    }}
                  >
                    <Icon name={t.icon} size={14} />
                    <span>{t.title}</span>
                  </a>
                ))}
              </div>
            ))}
          </nav>
        </details>
      </aside>
      <div className="help-main">
        <header className="help-intro">
          <h1>Help</h1>
          <p className="muted">
            Help for {parts[parts.length - 1].who}: what you can do here.
            {level === 0 && ' Log in to see what members can do, such as homebrew and discussions.'}
          </p>
        </header>
        {parts.map((p) => (
          <div key={p.id} className="help-part">
            {parts.length > 1 && <h2 className="help-part-title">{p.title}</h2>}
            {p.topics.map((t) => (
              <section key={t.id} id={`help-${t.id}`} className="help-section" aria-labelledby={`help-h-${t.id}`}>
                <h3 id={`help-h-${t.id}`}>
                  <Icon name={t.icon} size={18} />
                  {t.title}
                </h3>
                {t.body}
              </section>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
