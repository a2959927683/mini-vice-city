interface Entry<T> {
  x: number
  z: number
  value: T
}

export class SpatialHash<T> {
  private readonly cells = new Map<string, Entry<T>[]>()

  constructor(private readonly cellSize: number) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new Error('Spatial hash cell size must be a positive finite number.')
    }
  }

  clear(): void {
    this.cells.clear()
  }

  insert(x: number, z: number, value: T): void {
    const key = this.key(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize))
    const entries = this.cells.get(key)
    if (entries) {
      entries.push({ x, z, value })
    } else {
      this.cells.set(key, [{ x, z, value }])
    }
  }

  query(x: number, z: number, radius: number): T[] {
    const results: T[] = []
    const minimumX = Math.floor((x - radius) / this.cellSize)
    const maximumX = Math.floor((x + radius) / this.cellSize)
    const minimumZ = Math.floor((z - radius) / this.cellSize)
    const maximumZ = Math.floor((z + radius) / this.cellSize)
    const radiusSquared = radius * radius

    for (let cellX = minimumX; cellX <= maximumX; cellX++) {
      for (let cellZ = minimumZ; cellZ <= maximumZ; cellZ++) {
        const entries = this.cells.get(this.key(cellX, cellZ))
        if (!entries) continue
        for (const entry of entries) {
          if ((entry.x - x) ** 2 + (entry.z - z) ** 2 <= radiusSquared) {
            results.push(entry.value)
          }
        }
      }
    }
    return results
  }

  private key(cellX: number, cellZ: number): string {
    return `${cellX},${cellZ}`
  }
}
