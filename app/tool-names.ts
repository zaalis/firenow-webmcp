/**
 * The console tool catalogue, in registration order.
 *
 * The definitions themselves live in `firenow-client.tsx`, next to the state
 * they act on. This list is what the pages that cannot see those definitions
 * quote: the landing page tells an agent which tools appear after sign-in, and
 * the figure block advertises the count. Keeping one list means the two can
 * never drift apart from each other, and `scripts/test-simulation.mjs` checks
 * it against the definitions.
 */
export const CONSOLE_TOOL_NAMES = [
  'get_situation',
  'list_units',
  'get_fire_forecast',
  'get_weather',
  'query_terrain',
  'list_scenarios',
  'propose_plan',
  'stage_deploy_units',
  'stage_assign_task',
  'stage_firebreak',
  'stage_tactical_burn',
  'stage_evacuation_zone',
  'commit_plan',
  'revert_plan',
  'run_simulation',
  'set_time',
  'set_weather',
  'ignite',
  'compare_plans',
  'focus_region',
  'set_view_mode',
] as const;
