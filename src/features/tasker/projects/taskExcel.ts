import { utils } from "xlsx";
import {
	getSheetFields,
	getSheetValue,
	type SheetOptions,
	sheetValueLabel,
} from "./taskSheet";

export function buildTaskWorkbook(
	issues: (Parameters<typeof getSheetValue>[0] & {
		issueNumber?: number;
		description?: string;
	})[],
	project: { key: string; name: string },
	options: SheetOptions,
) {
	const fields = getSheetFields(options);
	const descriptions = issues.map((issue) => {
		const parts: string[] = [];
		let text = issue.description ?? "";
		while (text.length > 32767) {
			// Keep surrogate pairs together at Excel's cell text limit.
			const end = /[\uD800-\uDBFF]/.test(text[32766]) ? 32766 : 32767;
			parts.push(text.slice(0, end));
			text = text.slice(end);
		}
		return [...parts, text];
	});
	const descriptionHeaders = Array.from(
		{
			length: descriptions.reduce(
				(count, parts) => Math.max(count, parts.length),
				1,
			),
		},
		(_, index) => (index ? `Description (continued ${index})` : "Description"),
	);
	const sheet = utils.aoa_to_sheet([
		[
			"Task",
			"Project",
			...fields.map((field) => field.name),
			...descriptionHeaders,
		],
		...issues.map((issue, index) => [
			issue.issueNumber == null ? "" : `${project.key}-${issue.issueNumber}`,
			project.name,
			...fields.map((field) => {
				const value = getSheetValue(issue, field.key);
				return typeof value === "number" || typeof value === "boolean"
					? value
					: sheetValueLabel(field, value);
			}),
			...descriptions[index],
		]),
	]);
	sheet["!autofilter"] = { ref: sheet["!ref"] ?? "A1" };
	sheet["!cols"] = [
		{ wch: 16 },
		{ wch: 24 },
		...fields.map((field) => ({ wch: field.key === "title" ? 48 : 22 })),
		...descriptionHeaders.map(() => ({ wch: 60 })),
	];
	const workbook = utils.book_new();
	utils.book_append_sheet(workbook, sheet, "Tasks");
	return workbook;
}
