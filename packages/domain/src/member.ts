export type MemberStatus = "active" | "archived";

export type MemberOptions = {
  readonly id: string;
  readonly householdId: string;
  readonly displayName: string;
  readonly status: MemberStatus;
};

/** Local finance participant; archival preserves historical identity and references. */
export class Member {
  readonly id: string;
  // Account ownership must reference Members in its Household; integration validates that.
  readonly householdId: string;
  readonly displayName: string;
  readonly status: MemberStatus;

  constructor(options: MemberOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError("Member options must be an object.");
    }
    if (typeof options.id !== "string" || options.id.trim().length === 0) {
      throw new TypeError("Member ID must be a nonblank string.");
    }
    if (
      typeof options.householdId !== "string" ||
      options.householdId.trim().length === 0
    ) {
      throw new TypeError("Member Household ID must be a nonblank string.");
    }
    if (
      typeof options.displayName !== "string" ||
      options.displayName.trim().length === 0
    ) {
      throw new TypeError("Member display name must be a nonblank string.");
    }
    if (options.status !== "active" && options.status !== "archived") {
      throw new TypeError("Member status must be active or archived.");
    }

    this.id = options.id;
    this.householdId = options.householdId;
    this.displayName = options.displayName;
    this.status = options.status;
    Object.freeze(this);
  }
}
