export const POLL_INTERVAL_MS = 30_000;
export const WATCHDOG_BOOTSTRAP_DELAY_MS = 1_000;

type AlarmStorage = Pick<DurableObjectStorage, "getAlarm" | "setAlarm">;

export type AlarmWatchdogStatus = "already_scheduled" | "poll_running" | "scheduled";

export type AlarmWatchdogResult = {
  alarmScheduled: boolean;
  alarmTime: number | null;
  status: AlarmWatchdogStatus;
};

export const ensurePollingAlarm = async (input: {
  isPolling: boolean;
  now: () => number;
  storage: AlarmStorage;
}): Promise<AlarmWatchdogResult> => {
  if (input.isPolling) {
    return {
      alarmScheduled: false,
      alarmTime: null,
      status: "poll_running",
    };
  }

  const currentAlarm = await input.storage.getAlarm();
  if (currentAlarm !== null) {
    return {
      alarmScheduled: false,
      alarmTime: currentAlarm,
      status: "already_scheduled",
    };
  }

  const alarmTime = input.now() + WATCHDOG_BOOTSTRAP_DELAY_MS;
  await input.storage.setAlarm(alarmTime);

  return {
    alarmScheduled: true,
    alarmTime,
    status: "scheduled",
  };
};

export const scheduleNextPollingAlarm = async (input: {
  now: () => number;
  storage: Pick<DurableObjectStorage, "setAlarm">;
}): Promise<number> => {
  const alarmTime = input.now() + POLL_INTERVAL_MS;
  await input.storage.setAlarm(alarmTime);
  return alarmTime;
};
