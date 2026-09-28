# Permissions

This note explains how the server decides what a member may do: the
permission bits, roles, overwrites, and the order the server checks them
in. The same code (`packages/shared/src/permissions.ts`) runs on the
server and on the client, so a check gives the same answer in both
places.

## Permission bits

Each permission is one bit in a big number (a bitmask), for example
`VIEW_CHANNEL`, `SEND_MESSAGES`, or `MANAGE_GUILD`. A member's effective
permissions are one bitmask that can hold many bits at once.

## Roles

Every guild has an `@everyone` role. Its ID is the same as the guild ID.
Its permissions apply to every member, with no extra step. A member can
also hold other roles. The member's base permissions are the `@everyone`
permissions combined with every held role's permissions (bitwise OR).

## Overwrites

A channel can also carry overwrites: an `allow` mask and a `deny` mask,
for one role or for one member. An overwrite changes the base
permissions only inside that one channel.

## The order of the check

`computePermissions` builds one member's permissions in one channel, in
this order:

1. The guild owner gets every permission. No further check runs.
2. The base mask is `@everyone` permissions combined with every held
   role's permissions.
3. If the base mask holds `ADMINISTRATOR`, the member gets every
   permission. No further check runs.
4. The `@everyone` overwrite on the channel applies: its `deny` bits
   come off first, then its `allow` bits go on.
5. Every matching role overwrite applies the same way, combined first:
   all their `deny` bits come off, then all their `allow` bits go on.
6. A member-level overwrite, if one exists for this member, applies
   last: its `deny` bits come off, then its `allow` bits go on.

Deny always applies before allow, at each step. This means a later,
more specific overwrite (a role overwrite over `@everyone`, or a member
overwrite over a role) can undo an earlier deny.

## VIEW_CHANNEL is special

A member who ends up without `VIEW_CHANNEL` gets no permissions in that
channel at all: the server returns an empty mask, not a mask with just
`VIEW_CHANNEL` missing. This keeps one rule everywhere in the code: a
member with zero permissions in a channel cannot see it, so no route,
and no gateway dispatch, needs a separate "can they see this channel"
check next to the permission check.

## Role hierarchy

Every role has a `position`. The `@everyone` role is always position 0; it
cannot move and cannot be deleted. A member's **highest role** is the
largest position among the roles they hold (their held roles plus
`@everyone`). The guild owner has no position of their own: the owner
counts as above every role, and skips every hierarchy check below.

- A member may create, edit, delete or assign/remove only a role whose
  position is **strictly below** their own highest role. Assigning or
  removing `@everyone` is not an action (everyone always holds it).
- Creating a role places it just below the actor's highest role (shifting
  roles at or above that position up by one), or at position 1 when the
  actor's highest role is `@everyone` itself. For the owner, a new role
  goes just above the guild's current highest role, since the owner has
  no explicit position to sit below.
- A member may grant, through a role's `permissions` or a channel
  overwrite's `allow`/`deny`, only a permission bit they hold themselves.
  The owner and a member with `ADMINISTRATOR` may grant any permission.
- Acting on another member — kicking, banning, or changing their roles or
  nickname — requires the target's highest role to be strictly below the
  actor's highest role. **Nobody can act on the guild owner**, regardless
  of permissions.
- A channel overwrite may be edited only by someone with `MANAGE_ROLES`
  in that channel, and only with `allow`/`deny` bits the editor holds in
  that channel (unless admin or owner).

## Visibility changes

Granting or revoking `VIEW_CHANNEL` — through a role's permissions, a
channel overwrite, or a member's role list — can change which channels a
member can see. After any such change commits, the server compares each
affected member's set of viewable channels from just before the change to
just after:

- A channel they gained gets a `CHANNEL_CREATE` dispatch.
- A channel they lost gets a `CHANNEL_DELETE` dispatch.
- A channel whose visibility did not change for them gets nothing here
  (a plain `CHANNEL_UPDATE`, if the channel itself changed, is sent
  separately to whoever can still see it).

Because the fan-out for messages, reactions and edits always loads
permissions fresh (`GatewayService.toChannelViewers`), a member who lost
`VIEW_CHANNEL` stops receiving `EVENT_CREATE` for that channel the
instant the change commits, with no separate cache to invalidate.

The server also calls `voice.revalidate(guildId)` after the change, so a
member who lost `VIEW_CHANNEL` or `CONNECT` on their current voice
channel is disconnected from it and a `VOICE_STATE_UPDATE` (with a null
channel) is sent to that channel's former viewers.

## Where the server uses this

- Every guild and channel route loads the caller's member context first
  (`loadMemberContext` in `apps/server/src/modules/guilds/member-context.ts`):
  is the caller the owner, their `@everyone` role, their held roles, and
  every role in the guild. A caller who is not a member gets 404, not
  403, so a non-member cannot tell whether the guild exists.
- A guild-level check (for example `MANAGE_GUILD`) calls
  `computePermissions` with no overwrites.
- A channel-level check also loads that channel's overwrites first, so a
  channel can hide itself, or unlock a normally-locked action, for one
  role or one member.
- The gateway's fan-out (`docs/concepts/gateway.md`) uses the same
  function to decide, per guild member, who currently has `VIEW_CHANNEL`
  on a channel, so a `CHANNEL_*` dispatch only reaches members who can
  actually see that channel.
