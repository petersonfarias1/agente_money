/**
 * ==============================================================================
 * E2E Test Helper: Deterministic Virtual Clock (`deterministic_clock.ts`)
 * ==============================================================================
 * Enables reproducible virtual time-travel and multi-cycle epoch acceleration
 * for lifecycle, drawdown, and heartbeat schedule simulations.
 */

export class DeterministicClock {
  private currentTime: number;

  constructor(initialEpochMs: number = 1735689600000) {
    // Default initial epoch: 2025-01-01T00:00:00.000Z
    this.currentTime = initialEpochMs;
  }

  /**
   * Returns current virtual timestamp in epoch milliseconds.
   */
  public now(): number {
    return this.currentTime;
  }

  /**
   * Advances virtual clock by arbitrary milliseconds.
   */
  public advance(ms: number): void {
    this.currentTime += ms;
  }

  /**
   * Advances virtual clock by a designated number of daemon cycles.
   */
  public advanceCycles(cycles: number, intervalMs: number = 60000): void {
    this.currentTime += cycles * intervalMs;
  }

  /**
   * Advances virtual clock by seconds.
   */
  public advanceSeconds(seconds: number): void {
    this.currentTime += seconds * 1000;
  }

  /**
   * Advances virtual clock by minutes.
   */
  public advanceMinutes(minutes: number): void {
    this.currentTime += minutes * 60000;
  }

  /**
   * Advances virtual clock by days.
   */
  public advanceDays(days: number): void {
    this.currentTime += days * 86400000;
  }

  /**
   * Sets clock to an explicit timestamp.
   */
  public setTime(epochMs: number): void {
    this.currentTime = epochMs;
  }

  /**
   * Returns ISO string representation of the current virtual time.
   */
  public toISOString(): string {
    return new Date(this.currentTime).toISOString();
  }
}
