#!/usr/bin/env python3
"""T-028: extend tests/unit/background/chrome-mock.ts with
chrome.alarms.onAlarm (listener registry + fireAlarm helper) and
chrome.notifications (create/getPermissionLevel/clear/onClicked with
injectable failure), byte-exact."""

PATH = 'dev/tests/unit/background/chrome-mock.ts'

src = open(PATH, encoding='utf-8').read()

# 1. InstalledMock interface additions (after the alarms field).
old = """  tabs: Map<number, MockTab>;
  alarms: Map<string, { name: string; scheduledTime: number }>;
  storage: Map<string, unknown>;"""
new = """  tabs: Map<number, MockTab>;
  alarms: Map<string, { name: string; scheduledTime: number }>;
  /** chrome.alarms.onAlarm listeners (reminder firing, T-028). */
  alarmFired: Array<(alarm: { name: string; scheduledTime?: number }) => void>;
  /** chrome.notifications surface state (T-028, FR-REM-05). */
  notifications: {
    /** Created notifications by id (basic type). */
    created: Map<string, { title: string; message: string }>;
    /** Simulated permission level; default 'granted'. */
    permissionLevel: 'granted' | 'denied';
    /** When set, create() rejects with this error. */
    failNextCreate: Error | null;
    /** chrome.notifications.onClicked listeners. */
    clicked: Array<(notificationId: string) => void>;
  };
  storage: Map<string, unknown>;"""
assert src.count(old) == 1, f'interface anchor x{src.count(old)}'
src = src.replace(old, new)

# 2. Listener registry additions.
old = """    menuClicked: [],
    message: [],
  };"""
new = """    menuClicked: [],
    message: [],
    alarmFired: [],
    notificationClicked: [],
  };"""
assert src.count(old) == 1, f'listeners anchor x{src.count(old)}'
src = src.replace(old, new)

# 3. notifications state before the mock object.
old = """  const listeners: InstalledMock['listeners'] = {"""
new = """  const createdNotifications = new Map<string, { title: string; message: string }>();
  let notificationPermissionLevel: 'granted' | 'denied' = 'granted';
  let failNextNotificationCreate: Error | null = null;

  const listeners: InstalledMock['listeners'] = {"""
assert src.count(old) == 1, f'state anchor x{src.count(old)}'
src = src.replace(old, new)

# 4. alarms surface gains onAlarm; a notifications surface follows it.
old = """    alarms: {
      create: vi.fn((name: string, info: chrome.alarms.AlarmCreateInfo) => {
        alarms.set(name, { name, scheduledTime: info.when ?? Date.now() });
      }),
      clear: vi.fn(async (name: string) => alarms.delete(name)),
      getAll: vi.fn(async () => [...alarms.values()].map((a) => ({ ...a }))),
    },"""
new = """    alarms: {
      create: vi.fn((name: string, info: chrome.alarms.AlarmCreateInfo) => {
        alarms.set(name, { name, scheduledTime: info.when ?? Date.now() });
      }),
      clear: vi.fn(async (name: string) => alarms.delete(name)),
      getAll: vi.fn(async () => [...alarms.values()].map((a) => ({ ...a }))),
      onAlarm: {
        addListener: (fn: (alarm: { name: string; scheduledTime?: number }) => void) => {
          listeners.alarmFired.push(fn);
        },
      },
    },
    notifications: {
      create: vi.fn(
        async (notificationId: string, options: { title: string; message: string }) => {
          if (failNextNotificationCreate !== null) {
            const error = failNextNotificationCreate;
            failNextNotificationCreate = null;
            throw error;
          }
          createdNotifications.set(notificationId, {
            title: options.title,
            message: options.message,
          });
        },
      ),
      getPermissionLevel: vi.fn(async () => notificationPermissionLevel),
      clear: vi.fn(async (notificationId: string) => createdNotifications.delete(notificationId)),
      onClicked: {
        addListener: (fn: (notificationId: string) => void) => {
          listeners.notificationClicked.push(fn);
        },
      },
    },"""
assert src.count(old) == 1, f'alarms anchor x{src.count(old)}'
src = src.replace(old, new)

# 5. Return-handle additions.
old = """  return {
    listeners,
    tabs,
    alarms,
    storage,"""
new = """  return {
    listeners,
    tabs,
    alarms,
    alarmFired: listeners.alarmFired,
    notifications: {
      created: createdNotifications,
      get permissionLevel() {
        return notificationPermissionLevel;
      },
      set permissionLevel(value: 'granted' | 'denied') {
        notificationPermissionLevel = value;
      },
      get failNextCreate() {
        return failNextNotificationCreate;
      },
      set failNextCreate(value: Error | null) {
        failNextNotificationCreate = value;
      },
      clicked: listeners.notificationClicked,
    },
    storage,"""
assert src.count(old) == 1, f'return anchor x{src.count(old)}'
src = src.replace(old, new)

open(PATH, 'w', encoding='utf-8').write(src)
print('chrome-mock extended for T-028')
