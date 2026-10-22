/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as agentTasks from "../agentTasks.js";
import type * as agentTokens from "../agentTokens.js";
import type * as comments from "../comments.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as dev from "../dev.js";
import type * as github from "../github.js";
import type * as githubActions from "../githubActions.js";
import type * as http from "../http.js";
import type * as invitations from "../invitations.js";
import type * as invitationsActions from "../invitationsActions.js";
import type * as issueLists from "../issueLists.js";
import type * as issues from "../issues.js";
import type * as lib_activity from "../lib/activity.js";
import type * as lib_agentTokens from "../lib/agentTokens.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_github from "../lib/github.js";
import type * as lib_githubClient from "../lib/githubClient.js";
import type * as lib_githubLinks from "../lib/githubLinks.js";
import type * as lib_issueChecklists from "../lib/issueChecklists.js";
import type * as lib_issueDescriptions from "../lib/issueDescriptions.js";
import type * as lib_issueFilters from "../lib/issueFilters.js";
import type * as lib_notifications from "../lib/notifications.js";
import type * as lib_projectCustomFields from "../lib/projectCustomFields.js";
import type * as lib_projectLabels from "../lib/projectLabels.js";
import type * as lib_projectStatuses from "../lib/projectStatuses.js";
import type * as myWork from "../myWork.js";
import type * as notifications from "../notifications.js";
import type * as notificationsActions from "../notificationsActions.js";
import type * as projects from "../projects.js";
import type * as userNotes from "../userNotes.js";
import type * as users from "../users.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  agentTasks: typeof agentTasks;
  agentTokens: typeof agentTokens;
  comments: typeof comments;
  constants: typeof constants;
  crons: typeof crons;
  dashboard: typeof dashboard;
  dev: typeof dev;
  github: typeof github;
  githubActions: typeof githubActions;
  http: typeof http;
  invitations: typeof invitations;
  invitationsActions: typeof invitationsActions;
  issueLists: typeof issueLists;
  issues: typeof issues;
  "lib/activity": typeof lib_activity;
  "lib/agentTokens": typeof lib_agentTokens;
  "lib/auth": typeof lib_auth;
  "lib/github": typeof lib_github;
  "lib/githubClient": typeof lib_githubClient;
  "lib/githubLinks": typeof lib_githubLinks;
  "lib/issueChecklists": typeof lib_issueChecklists;
  "lib/issueDescriptions": typeof lib_issueDescriptions;
  "lib/issueFilters": typeof lib_issueFilters;
  "lib/notifications": typeof lib_notifications;
  "lib/projectCustomFields": typeof lib_projectCustomFields;
  "lib/projectLabels": typeof lib_projectLabels;
  "lib/projectStatuses": typeof lib_projectStatuses;
  myWork: typeof myWork;
  notifications: typeof notifications;
  notificationsActions: typeof notificationsActions;
  projects: typeof projects;
  userNotes: typeof userNotes;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
