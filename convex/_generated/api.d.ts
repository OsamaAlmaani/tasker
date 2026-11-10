/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentReads from "../agentReads.js";
import type * as agentTasks from "../agentTasks.js";
import type * as agentTokens from "../agentTokens.js";
import type * as agentWorkspace from "../agentWorkspace.js";
import type * as comments from "../comments.js";
import type * as constants from "../constants.js";
import type * as dashboard from "../dashboard.js";
import type * as dev from "../dev.js";
import type * as github from "../github.js";
import type * as githubActions from "../githubActions.js";
import type * as githubLinkActions from "../githubLinkActions.js";
import type * as githubLinks from "../githubLinks.js";
import type * as githubReviewInbox from "../githubReviewInbox.js";
import type * as githubReviewInboxActions from "../githubReviewInboxActions.js";
import type * as githubReviewTaskActions from "../githubReviewTaskActions.js";
import type * as githubReviewTasks from "../githubReviewTasks.js";
import type * as githubWebhooks from "../githubWebhooks.js";
import type * as githubWorkflowGroups from "../githubWorkflowGroups.js";
import type * as githubWorkflows from "../githubWorkflows.js";
import type * as http from "../http.js";
import type * as invitations from "../invitations.js";
import type * as invitationsActions from "../invitationsActions.js";
import type * as issueLists from "../issueLists.js";
import type * as issues from "../issues.js";
import type * as lib_activity from "../lib/activity.js";
import type * as lib_agentContext from "../lib/agentContext.js";
import type * as lib_agentOperations from "../lib/agentOperations.js";
import type * as lib_agentProtocol from "../lib/agentProtocol.js";
import type * as lib_agentTokens from "../lib/agentTokens.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_definitions from "../lib/definitions.js";
import type * as lib_githubAccess from "../lib/githubAccess.js";
import type * as lib_githubActors from "../lib/githubActors.js";
import type * as lib_githubApi from "../lib/githubApi.js";
import type * as lib_githubAutomation from "../lib/githubAutomation.js";
import type * as lib_githubCrypto from "../lib/githubCrypto.js";
import type * as lib_githubLinkSync from "../lib/githubLinkSync.js";
import type * as lib_githubReferences from "../lib/githubReferences.js";
import type * as lib_githubReviewInbox from "../lib/githubReviewInbox.js";
import type * as lib_githubReviewSync from "../lib/githubReviewSync.js";
import type * as lib_githubReviewTasks from "../lib/githubReviewTasks.js";
import type * as lib_githubWorkflowsApi from "../lib/githubWorkflowsApi.js";
import type * as lib_issueChecklists from "../lib/issueChecklists.js";
import type * as lib_issueDescriptions from "../lib/issueDescriptions.js";
import type * as lib_issueFilters from "../lib/issueFilters.js";
import type * as lib_notifications from "../lib/notifications.js";
import type * as lib_projectCustomFields from "../lib/projectCustomFields.js";
import type * as lib_projectLabels from "../lib/projectLabels.js";
import type * as lib_projectStatuses from "../lib/projectStatuses.js";
import type * as lib_workflowImpact from "../lib/workflowImpact.js";
import type * as lib_yamlLite from "../lib/yamlLite.js";
import type * as myWork from "../myWork.js";
import type * as notifications from "../notifications.js";
import type * as notificationsActions from "../notificationsActions.js";
import type * as projects from "../projects.js";
import type * as userNotes from "../userNotes.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentReads: typeof agentReads;
  agentTasks: typeof agentTasks;
  agentTokens: typeof agentTokens;
  agentWorkspace: typeof agentWorkspace;
  comments: typeof comments;
  constants: typeof constants;
  dashboard: typeof dashboard;
  dev: typeof dev;
  github: typeof github;
  githubActions: typeof githubActions;
  githubLinkActions: typeof githubLinkActions;
  githubLinks: typeof githubLinks;
  githubReviewInbox: typeof githubReviewInbox;
  githubReviewInboxActions: typeof githubReviewInboxActions;
  githubReviewTaskActions: typeof githubReviewTaskActions;
  githubReviewTasks: typeof githubReviewTasks;
  githubWebhooks: typeof githubWebhooks;
  githubWorkflowGroups: typeof githubWorkflowGroups;
  githubWorkflows: typeof githubWorkflows;
  http: typeof http;
  invitations: typeof invitations;
  invitationsActions: typeof invitationsActions;
  issueLists: typeof issueLists;
  issues: typeof issues;
  "lib/activity": typeof lib_activity;
  "lib/agentContext": typeof lib_agentContext;
  "lib/agentOperations": typeof lib_agentOperations;
  "lib/agentProtocol": typeof lib_agentProtocol;
  "lib/agentTokens": typeof lib_agentTokens;
  "lib/auth": typeof lib_auth;
  "lib/definitions": typeof lib_definitions;
  "lib/githubAccess": typeof lib_githubAccess;
  "lib/githubActors": typeof lib_githubActors;
  "lib/githubApi": typeof lib_githubApi;
  "lib/githubAutomation": typeof lib_githubAutomation;
  "lib/githubCrypto": typeof lib_githubCrypto;
  "lib/githubLinkSync": typeof lib_githubLinkSync;
  "lib/githubReferences": typeof lib_githubReferences;
  "lib/githubReviewInbox": typeof lib_githubReviewInbox;
  "lib/githubReviewSync": typeof lib_githubReviewSync;
  "lib/githubReviewTasks": typeof lib_githubReviewTasks;
  "lib/githubWorkflowsApi": typeof lib_githubWorkflowsApi;
  "lib/issueChecklists": typeof lib_issueChecklists;
  "lib/issueDescriptions": typeof lib_issueDescriptions;
  "lib/issueFilters": typeof lib_issueFilters;
  "lib/notifications": typeof lib_notifications;
  "lib/projectCustomFields": typeof lib_projectCustomFields;
  "lib/projectLabels": typeof lib_projectLabels;
  "lib/projectStatuses": typeof lib_projectStatuses;
  "lib/workflowImpact": typeof lib_workflowImpact;
  "lib/yamlLite": typeof lib_yamlLite;
  myWork: typeof myWork;
  notifications: typeof notifications;
  notificationsActions: typeof notificationsActions;
  projects: typeof projects;
  userNotes: typeof userNotes;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
