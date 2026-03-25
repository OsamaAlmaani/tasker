import { z } from "zod";
import { GLOBAL_ROLES, ISSUE_PRIORITIES } from "./model";

export const projectFormSchema = z.object({
	name: z.string().trim().min(2, "Project name is required."),
	key: z
		.string()
		.trim()
		.min(2, "Project key must have at least 2 characters.")
		.max(8, "Project key must be at most 8 characters."),
	description: z.string().trim().optional(),
	color: z.string().trim().optional(),
	icon: z.string().trim().optional(),
	allowMemberInvites: z.boolean().default(true),
	allowIssueDelete: z.boolean().default(true),
});

export const issueFormSchema = z.object({
	title: z.string().trim().min(2, "Task title is required."),
	description: z.string().trim().optional(),
	status: z.string().trim().min(1, "Status is required.").default("todo"),
	priority: z.enum(ISSUE_PRIORITIES).default("none"),
	assigneeId: z.string().trim().optional(),
	listId: z.string().trim().optional(),
	parentIssueId: z.string().trim().optional(),
	dueDate: z.string().trim().optional(),
	labels: z.string().trim().optional(),
});

export const commentFormSchema = z.object({
	body: z.string().trim().min(1, "Comment cannot be empty."),
});

export const userRoleSchema = z.object({
	role: z.enum(GLOBAL_ROLES),
});
