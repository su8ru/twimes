import { describe, expect, it } from "vitest";

import {
  ensurePollingAlarm,
  POLL_INTERVAL_MS,
  scheduleNextPollingAlarm,
  WATCHDOG_BOOTSTRAP_DELAY_MS,
} from "../../src/durable-objects/alarm-scheduler";

const NOW = 1_800_000_000_000;

describe("alarm scheduler", () => {
  it("does not read or schedule an alarm while polling is running", async () => {
    const storage = createFakeAlarmStorage({ alarmTime: null });

    const result = await ensurePollingAlarm({
      isPolling: true,
      now: () => NOW,
      storage,
    });

    expect(result).toEqual({
      alarmScheduled: false,
      alarmTime: null,
      status: "poll_running",
    });
    expect(storage.calls).toEqual([]);
  });

  it("keeps an existing alarm", async () => {
    const storage = createFakeAlarmStorage({ alarmTime: NOW + 10_000 });

    const result = await ensurePollingAlarm({
      isPolling: false,
      now: () => NOW,
      storage,
    });

    expect(result).toEqual({
      alarmScheduled: false,
      alarmTime: NOW + 10_000,
      status: "already_scheduled",
    });
    expect(storage.calls).toEqual(["getAlarm"]);
  });

  it("bootstraps an alarm when no poll is running and no alarm exists", async () => {
    const storage = createFakeAlarmStorage({ alarmTime: null });

    const result = await ensurePollingAlarm({
      isPolling: false,
      now: () => NOW,
      storage,
    });

    expect(result).toEqual({
      alarmScheduled: true,
      alarmTime: NOW + WATCHDOG_BOOTSTRAP_DELAY_MS,
      status: "scheduled",
    });
    expect(storage.calls).toEqual(["getAlarm", `setAlarm:${NOW + WATCHDOG_BOOTSTRAP_DELAY_MS}`]);
  });

  it("schedules the next polling alarm 30 seconds later", async () => {
    const storage = createFakeAlarmStorage({ alarmTime: null });

    const alarmTime = await scheduleNextPollingAlarm({
      now: () => NOW,
      storage,
    });

    expect(alarmTime).toBe(NOW + POLL_INTERVAL_MS);
    expect(storage.calls).toEqual([`setAlarm:${NOW + POLL_INTERVAL_MS}`]);
  });
});

type FakeAlarmStorage = Pick<DurableObjectStorage, "getAlarm" | "setAlarm"> & {
  calls: string[];
};

const createFakeAlarmStorage = (options: { alarmTime: number | null }): FakeAlarmStorage => {
  const calls: string[] = [];
  let alarmTime = options.alarmTime;

  return {
    calls,

    getAlarm: async () => {
      calls.push("getAlarm");
      return alarmTime;
    },

    setAlarm: async (nextAlarmTime) => {
      const nextAlarmTimeNumber =
        nextAlarmTime instanceof Date ? nextAlarmTime.getTime() : nextAlarmTime;
      calls.push(`setAlarm:${nextAlarmTimeNumber}`);
      alarmTime = nextAlarmTimeNumber;
    },
  };
};
