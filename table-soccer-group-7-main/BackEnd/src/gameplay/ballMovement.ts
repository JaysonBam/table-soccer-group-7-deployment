// Calculates server-side ball movement.

import {
  SOCCER_BALL_RADIUS,
  SOCCER_DEFAULT_BALL_SPEED_RANGE,
  SOCCER_FIELD,
  SOCCER_GOAL_OPENING,
  SOCCER_KICK_TUNING
} from "../shared/constants.ts";
import type { BallFieldDimensions, BallMovementReason, BallMovementState, TeamSide, Vector2D } from "../shared/types.ts";

export type BallBoundaryEvent =
  | {
      type: "wall-bounce";
      ballState: BallMovementState;
      timestamp: number;
    }
  | {
      type: "goal";
      position: Vector2D;
      scoringTeam: TeamSide;
      timestamp: number;
    };

type WallCollision = {
  axes: {
    x: boolean;
    y: boolean;
  };
  position: Vector2D;
  timestamp: number;
};

const MIN_DIRECTION_COMPONENT = 0.28;
const CENTER_SPAWN_JITTER = 0.06;
const COLLISION_EPSILON = 0.001;

export function createInitialBallMovementState(sequence: number): BallMovementState {
  return createSpawnBallMovementState(sequence, "spawn", Date.now());
}

export function createRoundResetBallMovementState(sequence: number, timestamp = Date.now()): BallMovementState {
  return createSpawnBallMovementState(sequence, "round-reset", timestamp);
}

export function createKickBallMovementState(
  state: BallMovementState,
  worldDirection: Vector2D,
  swipeDistance: number,
  swipeVelocity: number,
  timestamp = Date.now()
): BallMovementState | null {
  const direction = normalizeVector(worldDirection);

  if (getVectorLength(direction) === 0) {
    return null;
  }

  return {
    ...state,
    sequence: state.sequence + 1,
    reason: "kick",
    startPosition: clampBallPosition(getBallPositionAt(state, timestamp), state.radius, state.field),
    velocity: scaleVector(direction, getKickSpeed(swipeDistance, swipeVelocity)),
    friction: 0,
    serverTimestamp: timestamp
  };
}

export function createStoppedBallMovementState(state: BallMovementState, timestamp = Date.now()): BallMovementState {
  return {
    ...state,
    sequence: state.sequence + 1,
    reason: "round-reset",
    startPosition: clampBallPosition(getBallPositionAt(state, timestamp), state.radius, state.field),
    velocity: { x: 0, y: 0 },
    friction: 0,
    serverTimestamp: timestamp
  };
}

export function getNextBallBoundaryEvent(state: BallMovementState): BallBoundaryEvent | null {
  const collision = getNextWallCollision(state);

  if (!collision) {
    return null;
  }

  if (collision.axes.x && isInsideGoalOpening(collision.position.y, state.field)) {
    return {
      type: "goal",
      position: collision.position,
      scoringTeam: state.velocity.x < 0 ? "team1" : "team2",
      timestamp: collision.timestamp
    };
  }

  return {
    type: "wall-bounce",
    timestamp: collision.timestamp,
    ballState: {
      ...state,
      sequence: state.sequence + 1,
      reason: "wall-bounce",
      startPosition: collision.position,
      velocity: getReflectedVelocity(state.velocity, collision.axes),
      friction: 0,
      serverTimestamp: collision.timestamp
    }
  };
}

export function getBallPositionAt(state: BallMovementState, timestamp = Date.now()): Vector2D {
  const elapsedSeconds = Math.max(0, (timestamp - state.serverTimestamp) / 1000);

  return {
    x: state.startPosition.x + state.velocity.x * elapsedSeconds,
    y: state.startPosition.y + state.velocity.y * elapsedSeconds
  };
}

export function getBallSpeed(state: BallMovementState): number {
  return getVectorLength(state.velocity);
}

function createSpawnBallMovementState(sequence: number, reason: BallMovementReason, timestamp: number): BallMovementState {
  const speed = SOCCER_DEFAULT_BALL_SPEED_RANGE.min
    + Math.random() * (SOCCER_DEFAULT_BALL_SPEED_RANGE.max - SOCCER_DEFAULT_BALL_SPEED_RANGE.min);
  const direction = getRandomPlayableDirection();

  return {
    sequence,
    reason,
    startPosition: createCenterSpawnPosition(SOCCER_FIELD, SOCCER_BALL_RADIUS),
    velocity: scaleVector(direction, speed),
    friction: 0,
    serverTimestamp: timestamp,
    radius: SOCCER_BALL_RADIUS,
    field: SOCCER_FIELD
  };
}

function getNextWallCollision(state: BallMovementState): WallCollision | null {
  const speed = getBallSpeed(state);

  if (speed <= 0) {
    return null;
  }

  const direction = normalizeVector(state.velocity);
  const collision = {
    x: getAxisCollisionDistance(state.startPosition.x, direction.x, state.radius, state.field.width - state.radius),
    y: getAxisCollisionDistance(state.startPosition.y, direction.y, state.radius, state.field.height - state.radius)
  };
  const collisionDistance = Math.min(collision.x ?? Number.POSITIVE_INFINITY, collision.y ?? Number.POSITIVE_INFINITY);

  if (!Number.isFinite(collisionDistance)) {
    return null;
  }

  const timestamp = state.serverTimestamp + Math.round((collisionDistance / speed) * 1000);
  const collisionPosition = getBallPositionAt(state, timestamp);

  return {
    axes: {
      x: collision.x !== null && Math.abs(collision.x - collisionDistance) <= COLLISION_EPSILON,
      y: collision.y !== null && Math.abs(collision.y - collisionDistance) <= COLLISION_EPSILON
    },
    position: clampBallPosition(collisionPosition, state.radius, state.field),
    timestamp
  };
}

function getAxisCollisionDistance(position: number, direction: number, min: number, max: number): number | null {
  if (direction > 0) {
    return Math.max((max - position) / direction, 0);
  }

  if (direction < 0) {
    return Math.max((min - position) / direction, 0);
  }

  return null;
}

function getReflectedVelocity(velocity: Vector2D, axes: { x: boolean; y: boolean }): Vector2D {
  const speed = getVectorLength(velocity);
  const reflectedVelocity = {
    x: axes.x ? -velocity.x : velocity.x,
    y: axes.y ? -velocity.y : velocity.y
  };

  return scaleVector(normalizeVector(reflectedVelocity), speed);
}

function isInsideGoalOpening(yPosition: number, field: BallFieldDimensions): boolean {
  const goalCenter = field.height / 2;
  const goalHalfHeight = SOCCER_GOAL_OPENING.height / 2;

  return yPosition >= goalCenter - goalHalfHeight && yPosition <= goalCenter + goalHalfHeight;
}

function getKickSpeed(swipeDistance: number, swipeVelocity: number): number {
  const normalizedDistance = clamp(swipeDistance / SOCCER_KICK_TUNING.maxSwipeDistance, 0, 1);
  const normalizedVelocity = clamp(swipeVelocity / SOCCER_KICK_TUNING.maxSwipeVelocity, 0, 1);
  const power = clamp(normalizedVelocity * 0.6 + normalizedDistance * 0.4, 0, 1);

  return SOCCER_KICK_TUNING.minKickSpeed
    + power * (SOCCER_KICK_TUNING.maxKickSpeed - SOCCER_KICK_TUNING.minKickSpeed);
}

function getRandomPlayableDirection(): Vector2D {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const direction = {
      x: Math.cos(angle),
      y: Math.sin(angle)
    };

    if (Math.abs(direction.x) >= MIN_DIRECTION_COMPONENT && Math.abs(direction.y) >= MIN_DIRECTION_COMPONENT) {
      return direction;
    }
  }

  return normalizeVector({ x: 1, y: 0.65 });
}

function createCenterSpawnPosition(field: BallFieldDimensions, radius: number): Vector2D {
  return clampBallPosition({
    x: field.width / 2 + (Math.random() - 0.5) * field.width * CENTER_SPAWN_JITTER,
    y: field.height / 2 + (Math.random() - 0.5) * field.height * CENTER_SPAWN_JITTER
  }, radius, field);
}

function clampBallPosition(position: Vector2D, radius: number, field: BallFieldDimensions): Vector2D {
  return {
    x: clamp(position.x, radius, field.width - radius),
    y: clamp(position.y, radius, field.height - radius)
  };
}

function scaleVector(vector: Vector2D, scalar: number): Vector2D {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar
  };
}

function normalizeVector(vector: Vector2D): Vector2D {
  const length = getVectorLength(vector);

  if (length === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length
  };
}

function getVectorLength(vector: Vector2D): number {
  return Math.hypot(vector.x, vector.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
