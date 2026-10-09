#ifndef A1_TRACE_H
#define A1_TRACE_H

/* Private, cumulative instrumentation for the controlled-title experiment. */
enum {
  A1_C_INIT,
  A1_ENGINE_CREATE,
  A1_TITLE_PREPARE,
  A1_NATIVE_BUILD,
  A1_PLAYER_ENTRY,
  A1_WORLD_COMPLETE,
  A1_OUTER_COMPLETE,
  A1_SCHEDULER_ENTRY,
  A1_NET_BODY,
  A1_NET_INTERCEPT,
  A1_WIPE_ENTRY,
  A1_DEMO_LOAD,
  A1_RENDER,
  A1_FRAME,
  A1_COUNT_LIMIT
};

#ifdef DOOM_CONTROLLED_TITLE
#include <stdint.h>
extern uint32_t a1_counts[A1_COUNT_LIMIT];
#define A1_COUNT(index) (++a1_counts[index])
#else
#define A1_COUNT(index) ((void)0)
#endif

#endif
