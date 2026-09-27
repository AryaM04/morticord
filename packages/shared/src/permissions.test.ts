// Table-driven tests for the permission calculator.
// Each case gives an input and the expected effective permission mask.
import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  computePermissions,
  hasPermission,
  Permission,
  type ComputePermissionsInput,
} from "./permissions.js";

const EVERYONE_ID = 1n;
const ADMIN_ROLE_ID = 2n;
const MOD_ROLE_ID = 3n;
const MEMBER_ID = 100n;
const OTHER_MEMBER_ID = 200n;

function baseInput(overrides: Partial<ComputePermissionsInput> = {}): ComputePermissionsInput {
  return {
    isOwner: false,
    everyoneRole: { id: EVERYONE_ID, permissions: Permission.VIEW_CHANNEL },
    memberRoles: [],
    overwrites: [],
    memberId: MEMBER_ID,
    ...overrides,
  };
}

describe("computePermissions", () => {
  const cases: Array<{ name: string; input: ComputePermissionsInput; expected: bigint }> = [
    {
      name: "owner gets every permission, even with no roles",
      input: baseInput({ isOwner: true, everyoneRole: { id: EVERYONE_ID, permissions: 0n } }),
      expected: ALL_PERMISSIONS,
    },
    {
      name: "plain member gets only the @everyone base permissions",
      input: baseInput(),
      expected: Permission.VIEW_CHANNEL,
    },
    {
      name: "a role adds its permissions to the base mask",
      input: baseInput({
        memberRoles: [{ id: MOD_ROLE_ID, permissions: Permission.SEND_MESSAGES }],
      }),
      expected: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES,
    },
    {
      name: "ADMINISTRATOR on a role grants every permission",
      input: baseInput({
        memberRoles: [{ id: ADMIN_ROLE_ID, permissions: Permission.ADMINISTRATOR }],
      }),
      expected: ALL_PERMISSIONS,
    },
    {
      name: "an @everyone deny overwrite removes a base permission",
      input: baseInput({
        overwrites: [
          { targetId: EVERYONE_ID, targetType: "role", allow: 0n, deny: Permission.VIEW_CHANNEL },
        ],
      }),
      expected: 0n,
    },
    {
      name: "an @everyone allow overwrite adds a permission not in the base mask",
      input: baseInput({
        overwrites: [
          {
            targetId: EVERYONE_ID,
            targetType: "role",
            allow: Permission.SEND_MESSAGES,
            deny: 0n,
          },
        ],
      }),
      expected: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES,
    },
    {
      name: "a role deny overwrite beats the @everyone allow overwrite",
      input: baseInput({
        memberRoles: [{ id: MOD_ROLE_ID, permissions: 0n }],
        overwrites: [
          {
            targetId: EVERYONE_ID,
            targetType: "role",
            allow: Permission.SEND_MESSAGES,
            deny: 0n,
          },
          {
            targetId: MOD_ROLE_ID,
            targetType: "role",
            allow: 0n,
            deny: Permission.SEND_MESSAGES,
          },
        ],
      }),
      expected: Permission.VIEW_CHANNEL,
    },
    {
      name: "combined role overwrites: one role's allow beats another role's deny",
      input: baseInput({
        memberRoles: [
          { id: MOD_ROLE_ID, permissions: 0n },
          { id: ADMIN_ROLE_ID, permissions: 0n },
        ],
        overwrites: [
          {
            targetId: MOD_ROLE_ID,
            targetType: "role",
            allow: 0n,
            deny: Permission.SEND_MESSAGES,
          },
          {
            targetId: ADMIN_ROLE_ID,
            targetType: "role",
            allow: Permission.SEND_MESSAGES,
            deny: 0n,
          },
        ],
      }),
      expected: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES,
    },
    {
      name: "a member overwrite beats a role overwrite",
      input: baseInput({
        memberRoles: [{ id: MOD_ROLE_ID, permissions: Permission.SEND_MESSAGES }],
        overwrites: [
          {
            targetId: MOD_ROLE_ID,
            targetType: "role",
            allow: 0n,
            deny: Permission.SEND_MESSAGES,
          },
          {
            targetId: MEMBER_ID,
            targetType: "member",
            allow: Permission.SEND_MESSAGES,
            deny: 0n,
          },
        ],
      }),
      expected: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES,
    },
    {
      name: "a member deny overwrite beats a role allow overwrite",
      input: baseInput({
        memberRoles: [{ id: MOD_ROLE_ID, permissions: Permission.SEND_MESSAGES }],
        overwrites: [
          {
            targetId: MEMBER_ID,
            targetType: "member",
            allow: 0n,
            deny: Permission.SEND_MESSAGES,
          },
        ],
      }),
      expected: Permission.VIEW_CHANNEL,
    },
    {
      name: "a member overwrite for a different member has no effect",
      input: baseInput({
        overwrites: [
          {
            targetId: OTHER_MEMBER_ID,
            targetType: "member",
            allow: Permission.SEND_MESSAGES,
            deny: 0n,
          },
        ],
      }),
      expected: Permission.VIEW_CHANNEL,
    },
    {
      name: "ADMINISTRATOR from the base mask ignores every overwrite",
      input: baseInput({
        memberRoles: [{ id: ADMIN_ROLE_ID, permissions: Permission.ADMINISTRATOR }],
        overwrites: [
          { targetId: EVERYONE_ID, targetType: "role", allow: 0n, deny: ALL_PERMISSIONS },
          { targetId: MEMBER_ID, targetType: "member", allow: 0n, deny: ALL_PERMISSIONS },
        ],
      }),
      expected: ALL_PERMISSIONS,
    },
    {
      name: "a member that cannot see the channel has no permissions in it",
      input: baseInput({
        everyoneRole: {
          id: EVERYONE_ID,
          permissions: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES,
        },
        overwrites: [
          { targetId: EVERYONE_ID, targetType: "role", allow: 0n, deny: Permission.VIEW_CHANNEL },
        ],
      }),
      expected: 0n,
    },
  ];

  for (const { name, input, expected } of cases) {
    it(name, () => {
      expect(computePermissions(input)).toBe(expected);
    });
  }
});

describe("hasPermission", () => {
  it("returns true when every bit of the flag is set in the mask", () => {
    expect(hasPermission(Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES, Permission.SEND_MESSAGES)).toBe(
      true,
    );
  });

  it("returns false when the flag bit is missing from the mask", () => {
    expect(hasPermission(Permission.VIEW_CHANNEL, Permission.SEND_MESSAGES)).toBe(false);
  });
});
