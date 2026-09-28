/** Strings are important confirmations; routine saves stay beside their form
 * or are announced without a visual banner when navigation confirms the result.
 */
export type SavedFeedback = { saved: string };
export type ActionFeedback = string | SavedFeedback | { announcement: string };
