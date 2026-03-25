/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as comments from "../comments.js";
import type * as constants from "../constants.js";
import type * as dashboard from "../dashboard.js";
import type * as dev from "../dev.js";
import type * as invitations from "../invitations.js";
import type * as invitationsActions from "../invitationsActions.js";
import type * as issueLists from "../issueLists.js";
import type * as issues from "../issues.js";
import type * as lib_activity from "../lib/activity.js";
import type * as lib_auth from "../lib/auth.js";
import type * as myWork from "../myWork.js";
import type * as projects from "../projects.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  comments: typeof comments;
  constants: typeof constants;
  dashboard: typeof dashboard;
  dev: typeof dev;
  invitations: typeof invitations;
  invitationsActions: typeof invitationsActions;
  issueLists: typeof issueLists;
  issues: typeof issues;
  "lib/activity": typeof lib_activity;
  "lib/auth": typeof lib_auth;
  myWork: typeof myWork;
  projects: typeof projects;
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
