/** Bump whenever the MCP connector's TOOL SET changes — a tool added, removed or
 * renamed. MCP clients cache the tool list, so a new tool is invisible until the
 * athlete removes and re-adds the connector. The /app notifications bell compares
 * this to the version the athlete last acknowledged and flags "update your
 * connector" so their AI actually loads the new tools.
 *
 * History:
 *   1 — get_meal_plan + get_body_composition (read parity) and the season field
 *       on get_profile.
 *   2 — delete_workout, relink_activity, equipment as an enum, actual_rpe, the
 *       `other` discipline, and `external_id` on upsert_workout — the last one
 *       being what stops an AI-logged session and the athlete's own device sync
 *       from producing two rows for the same workout. */
export const CONNECTOR_VERSION = 2;
