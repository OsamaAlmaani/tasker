import { describe, expect, it } from "vitest";
import { issueFormSchema } from "./validation";

describe("issue custom-field validation", () => {
	it("accepts text and checkbox drafts without losing false values", () => {
		const customFieldValues = { notes: "", points: "3", approved: false };
		expect(
			issueFormSchema.parse({ title: "Task", customFieldValues })
				.customFieldValues,
		).toEqual(customFieldValues);
	});

	it("defaults missing custom fields to an empty record", () => {
		expect(issueFormSchema.parse({ title: "Task" }).customFieldValues).toEqual(
			{},
		);
	});

	it.each([
		null,
		3,
		[],
		{ nested: true },
	])("rejects unsupported custom-field values: %j", (value) => {
		expect(
			issueFormSchema.safeParse({
				title: "Task",
				customFieldValues: { field: value },
			}).success,
		).toBe(false);
	});
});
