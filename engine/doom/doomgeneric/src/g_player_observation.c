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
//   Read-only player inventory observations.
//

#include "g_player_observation.h"

#ifdef DOOM_CONTROLLED_TITLE
#ifndef DOOM_A1_NO_FIXTURES
#include "d_items.h"

int A21ObservePlayerInventory(const player_t *player, int index) {
  /* Fixed ammo enums never index via am_noammo. */
  switch (index) {
  case 76:
    return player->armorpoints;
  case 77:
    return player->readyweapon;
  case 78:
    if (player->readyweapon < wp_fist || player->readyweapon >= NUMWEAPONS)
      return -1;
    return weaponinfo[player->readyweapon].ammo;
  case 79:
    return player->ammo[am_clip];
  case 80:
    return player->ammo[am_shell];
  case 81:
    return player->ammo[am_cell];
  case 82:
    return player->ammo[am_misl];
  case 83:
    return player->maxammo[am_clip];
  case 84:
    return player->maxammo[am_shell];
  case 85:
    return player->maxammo[am_cell];
  case 86:
    return player->maxammo[am_misl];
  default:
    return -1;
  }
}
#endif
#endif
