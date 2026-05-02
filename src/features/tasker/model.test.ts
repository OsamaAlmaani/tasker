import { describe, expect, it } from "vitest";
import {
	canManageAdmins,
	canManageOwners,
	canWriteRole,
	globalRoleLabel,
	isAdminRole,
	isOwnerRole,
} from "#/features/tasker/model";

describe("global roles", () => {
	it("treats owner as admin-equivalent for non-owner powers", () => {
		expect(isOwnerRole("owner")).toBe(true);
		expect(isAdminRole("owner")).toBe(true);
		expect(isAdminRole("admin")).toBe(true);
		expect(isAdminRole("member")).toBe(false);
		expect(canWriteRole("owner")).toBe(true);
		expect(canWriteRole("admin")).toBe(true);
		expect(canWriteRole("member")).toBe(true);
		expect(canWriteRole("viewer")).toBe(false);
	});

	it("allows only owners to manage owners", () => {
		expect(canManageOwners("owner")).toBe(true);
		expect(canManageOwners("admin")).toBe(false);
		expect(canManageOwners("member")).toBe(false);
		expect(canManageAdmins("owner")).toBe(true);
		expect(canManageAdmins("admin")).toBe(true);
		expect(canManageAdmins("member")).toBe(false);
	});

	it("exposes owner label", () => {
		expect(globalRoleLabel.owner).toBe("Owner");
	});
});
