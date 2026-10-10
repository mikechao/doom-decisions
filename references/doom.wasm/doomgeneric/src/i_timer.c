//
// Copyright(C) 1993-1996 Id Software, Inc.
// Copyright(C) 2005-2014 Simon Howard
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// DESCRIPTION:
//      Timer functions.
//

#include "i_timer.h"
#include "doomtype.h"

#include "doomgeneric.h"

#include <stdarg.h>

//#include <sys/time.h>
//#include <unistd.h>

//
// I_GetTime
// returns time in 1/35th second tics
//

#ifdef DOOM_CONTROLLED_TITLE
static int controlled_tics;

void I_A21CommitTic(int completed_gametic) {
  if (controlled_tics != 0 || completed_gametic != controlled_tics + 1)
    __builtin_trap();
  ++controlled_tics;
}
#else
static uint64_t basetime = 0;
#endif

uint64_t I_GetTicks(void) {
#ifdef DOOM_CONTROLLED_TITLE
  return (uint64_t)controlled_tics * 1000 / TICRATE;
#else
  return DG_GetTicksMs();
#endif
}

int I_GetTime(void) {
#ifdef DOOM_CONTROLLED_TITLE
  return controlled_tics;
#else
  uint32_t ticks;

  ticks = I_GetTicks();

  if (basetime == 0)
    basetime = ticks;

  ticks -= basetime;

  return (ticks * TICRATE) / 1000;
#endif
}

//
// Same as I_GetTime, but returns time in milliseconds
//

int I_GetTimeMS(void) {
#ifdef DOOM_CONTROLLED_TITLE
  return (uint64_t)controlled_tics * 1000 / TICRATE;
#else
  uint32_t ticks;

  ticks = I_GetTicks();

  if (basetime == 0)
    basetime = ticks;

  return ticks - basetime;
#endif
}

// Sleep for a specified number of ms

void I_Sleep(int ms) {
  // SDL_Delay(ms);
  // usleep (ms * 1000);

  DG_SleepMs(ms);
}

void I_WaitVBL(int count) {
  // I_Sleep((count * 1000) / 70);
}

void I_InitTimer(void) {
  // initialize timer

  // SDL_Init(SDL_INIT_TIMER);
}
