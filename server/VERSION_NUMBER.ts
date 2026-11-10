/**
 * Version of the database schema expected by this code. The version of the data lives in the text file
 * VERSION_NUMBER next to the database (dist/VERSION_NUMBER). At start-up, the migrations of migrations/ that lie
 * between the two are run in order (see Database.initialize).
 *
 *   1: v1.0.0
 *   2: v1.1.0 (habits, actual duration of meetings)
 */
export const VERSION_NUMBER = 2;
