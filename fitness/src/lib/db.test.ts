import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { addImportedWorkouts, makeBackup, restoreBackup } from './backup'
import { ensureCheckIn, refreshTargets } from './coach'
import { addDays, today } from './dates'
import { db } from './db'
import { defaultSettings, loadSettings, updateSettings } from './settings'
import type { Workout } from './types'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('settings', () => {
  it('fills in defaults and persists patches', async () => {
    expect((await loadSettings()).onboarded).toBe(false)
    await updateSettings({ onboarded: true, restSec: 120 })
    const s = await loadSettings()
    expect(s.onboarded).toBe(true)
    expect(s.restSec).toBe(120)
    expect(s.profile).toEqual(defaultSettings().profile)
  })
})

describe('weekly check-in', () => {
  it('starts from the formula and only re-checks after a week', async () => {
    const s = { ...defaultSettings(), goal: { type: 'lose' as const, ratePct: 0.5 } }
    await db.body.put({ date: today(), weightKg: 80 })
    const first = await ensureCheckIn(s)
    expect(first.confidence).toBe(0)
    expect(first.expenditure).toBe(Math.round(first.formula / 10) * 10)
    expect(first.targets.kcal).toBeLessThan(first.expenditure)
    expect(first.seen).toBe(true)
    expect((await ensureCheckIn(s)).date).toBe(first.date)

    // Pretend the first check-in was 7 days ago: a new one is created.
    await db.checkins.clear()
    await db.checkins.put({ ...first, date: addDays(today(), -7) })
    const second = await ensureCheckIn(s)
    expect(second.date).toBe(today())
    expect(second.seen).toBe(false)
    expect(await db.checkins.count()).toBe(2)
  })

  it('redoes targets when the goal changes', async () => {
    const s = defaultSettings()
    await db.body.put({ date: today(), weightKg: 80 })
    const before = await ensureCheckIn(s)
    await refreshTargets({ ...s, goal: { type: 'gain', ratePct: 0.25 } })
    const after = await db.checkins.get(before.date)
    expect(after!.targets.kcal).toBeGreaterThan(before.targets.kcal)
  })
})

describe('backup', () => {
  it('round-trips every table, photos included', async () => {
    await db.entries.put({ id: 'e1', date: today(), meal: 'lunch', name: 'Rice', n: { kcal: 200, protein: 4, carbs: 44, fat: 0.4 }, createdAt: 1 })
    await db.photos.put({ id: 'p1', date: today(), pose: 'front', blob: new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' }), createdAt: 1 })
    await updateSettings({ onboarded: true })
    const json = JSON.parse(JSON.stringify(await makeBackup({ photos: true })))

    await Promise.all(db.tables.map((t) => t.clear()))
    await restoreBackup(json)
    expect((await db.entries.get('e1'))?.name).toBe('Rice')
    expect((await loadSettings()).onboarded).toBe(true)
    const p = await db.photos.get('p1')
    expect(p!.blob.type).toBe('image/jpeg')
    expect([...new Uint8Array(await p!.blob.arrayBuffer())]).toEqual([1, 2, 3, 250])
  })

  it('keeps existing photos when the backup has none, and rejects junk', async () => {
    await db.photos.put({ id: 'p1', date: today(), pose: 'front', blob: new Blob(['x']), createdAt: 1 })
    await restoreBackup(JSON.parse(JSON.stringify(await makeBackup({ photos: false }))))
    expect(await db.photos.count()).toBe(1)
    await expect(restoreBackup({ hello: 1 })).rejects.toThrow(/Forge backup/)
  })
})

describe('addImportedWorkouts', () => {
  it('skips workouts that are already saved', async () => {
    const w: Workout = { id: 'a', name: 'Legs', start: 1_000_000, end: 2_000_000, exercises: [] }
    expect(await addImportedWorkouts([w], [])).toEqual({ added: 1, skipped: 0 })
    expect(await addImportedWorkouts([{ ...w, id: 'b', start: 1_030_000 }], [])).toEqual({ added: 0, skipped: 1 })
  })
})
