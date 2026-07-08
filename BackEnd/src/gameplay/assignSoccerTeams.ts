// Assigns players to teams and roles.

import { TEAM_PLAYER_LIMIT } from "../shared/constants.ts";
import type { AssignedPlayer, Lobby, Player, SoccerRole, TeamSide } from "../shared/types.ts";
import { getActivePlayers, TEAM_CONFIG } from "../shared/types.ts";
import { AppError } from "../shared/errors.ts";

const TEAM_VERTICAL_LANES: Record<TeamSide, Record<SoccerRole, number>> = {
  team1: {
    goalkeeper: 88,
    defender: 72,
    midfielder: 56,
    attacker: 40
  },
  team2: {
    goalkeeper: 12,
    defender: 28,
    midfielder: 44,
    attacker: 60
  }
};

export function assignSoccerTeams(lobby: Lobby): AssignedPlayer[] {
  const activePlayers = getActivePlayers(lobby.players);
  const minGamePlayers = TEAM_PLAYER_LIMIT.min * 2;
  const maxGamePlayers = TEAM_PLAYER_LIMIT.max * 2;

  if (activePlayers.length < minGamePlayers || activePlayers.length > maxGamePlayers) {
    throw new AppError(400, `A game must have between ${minGamePlayers} and ${maxGamePlayers} players.`);
  }

  const team1Players = activePlayers.filter((_, index) => index % 2 === 0);
  const team2Players = activePlayers.filter((_, index) => index % 2 === 1);
  return [...assignTeamPlayers(team1Players, "team1"), ...assignTeamPlayers(team2Players, "team2")];
}

function assignTeamPlayers(players: Player[], teamSide: TeamSide): AssignedPlayer[] {
  if (players.length < TEAM_PLAYER_LIMIT.min || players.length > TEAM_PLAYER_LIMIT.max) {
    throw new AppError(400, `A team must have between ${TEAM_PLAYER_LIMIT.min} and ${TEAM_PLAYER_LIMIT.max} players.`);
  }

  const shuffledPlayers = shuffle(players);
  const roleSequence = createRoleSequence(players.length);
  const roleTotals: Record<SoccerRole, number> = {
    goalkeeper: 0,
    defender: 0,
    midfielder: 0,
    attacker: 0
  };
  const roleCounts: Record<SoccerRole, number> = {
    goalkeeper: 0,
    defender: 0,
    midfielder: 0,
    attacker: 0
  };

  for (const role of roleSequence) {
    roleTotals[role] += 1;
  }

  // Players are shuffled once so join order does not decide roles or positions.
  return shuffledPlayers.map((player, index): AssignedPlayer => {
    const role = roleSequence[index];
    const laneIndex = roleCounts[role];
    const roleTotal = roleTotals[role];
    const horizontalSlot = roleTotal <= 1 ? 0 : -0.78 + (laneIndex / (roleTotal - 1)) * 1.56;

    roleCounts[role] += 1;

    return {
      id: player.id,
      name: player.name,
      team: TEAM_CONFIG[teamSide].playerTeam,
      role,
      verticalLane: TEAM_VERTICAL_LANES[teamSide][role],
      horizontalSlot
    };
  });
}

function createRoleSequence(playerCount: number): SoccerRole[] {
  if (playerCount === 3) {
    return ["goalkeeper", "defender", "attacker"];
  }

  const roleSequence: SoccerRole[] = ["goalkeeper"];
  const outfieldRoleCycle: SoccerRole[] = ["midfielder", "defender", "attacker"];

  for (let playerIndex = 1; playerIndex < playerCount; playerIndex += 1) {
    roleSequence.push(outfieldRoleCycle[(playerIndex - 1) % outfieldRoleCycle.length]);
  }

  return roleSequence;
}

function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const targetIndex = Math.floor(Math.random() * (index + 1));
    const currentItem = result[index];

    result[index] = result[targetIndex];
    result[targetIndex] = currentItem;
  }

  return result;
}
