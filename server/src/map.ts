export const TILE_SIZE = 32;
export const MAP_WIDTH = 20;
export const MAP_HEIGHT = 15;

// Chebyshev-distance (tile "square") radius within which two players are
// considered close enough to start a video call, mirroring ZEP/Gather.town's
// proximity chat.
export const PROXIMITY_RADIUS = 3;

// 0 = floor (walkable), 1 = wall (blocked)
// Border walls + a couple of inner obstacles, roughly resembling a small office layout.
export const WALLS: number[][] = (() => {
  const grid: number[][] = Array.from({ length: MAP_HEIGHT }, () =>
    Array<number>(MAP_WIDTH).fill(0)
  );

  for (let x = 0; x < MAP_WIDTH; x++) {
    grid[0][x] = 1;
    grid[MAP_HEIGHT - 1][x] = 1;
  }
  for (let y = 0; y < MAP_HEIGHT; y++) {
    grid[y][0] = 1;
    grid[y][MAP_WIDTH - 1] = 1;
  }

  // A couple of inner "desks" as obstacles.
  const desks = [
    [4, 3], [4, 4], [5, 3], [5, 4],
    [12, 8], [13, 8], [12, 9], [13, 9],
    [8, 6], [9, 6],
  ];
  for (const [x, y] of desks) {
    grid[y][x] = 1;
  }

  return grid;
})();

export function isWalkable(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return false;
  return WALLS[y][x] === 0;
}

export function randomSpawnPoint(): { x: number; y: number } {
  while (true) {
    const x = Math.floor(Math.random() * MAP_WIDTH);
    const y = Math.floor(Math.random() * MAP_HEIGHT);
    if (isWalkable(x, y)) return { x, y };
  }
}
