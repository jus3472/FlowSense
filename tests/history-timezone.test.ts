import { describe, expect, it } from 'vitest'
import { dayLabel, groupByDay, timeLabel, type HistoryEntry } from '@/lib/results/history'

function entry(id: string, createdAt: string): HistoryEntry {
  return {
    id,
    createdAt,
    promptText: id,
    score: 80,
  }
}

describe('history timezone rendering', () => {
  it('does not let the host timezone change serialized render output', () => {
    const entries = [
      entry('newer', '2026-08-28T04:30:00.000Z'),
      entry('older', '2026-08-28T03:30:00.000Z'),
    ]
    const renderedAt = new Date('2026-08-28T16:00:00.000Z')
    const originalTimezone = process.env.TZ

    try {
      process.env.TZ = 'Pacific/Honolulu'
      const honoluluHost = groupByDay(entries, renderedAt, 'America/New_York')
      process.env.TZ = 'Asia/Kolkata'
      const kolkataHost = groupByDay(entries, renderedAt, 'America/New_York')

      expect(honoluluHost).toEqual(kolkataHost)
      expect(honoluluHost.map(({ key, label }) => ({ key, label }))).toEqual([
        { key: '2026-08-28', label: 'Today' },
        { key: '2026-08-27', label: 'Yesterday' },
      ])
    } finally {
      process.env.TZ = originalTimezone
    }
  })

  it('formats one instant in the explicit user timezone', () => {
    const instant = '2026-08-28T03:30:00.000Z'

    expect(timeLabel(instant, 'America/New_York')).toBe('11:30 PM')
    expect(timeLabel(instant, 'Asia/Tokyo')).toBe('12:30 PM')
  })

  it('falls back to UTC when a stored timezone is missing or invalid', () => {
    const instant = '2026-08-28T03:30:00.000Z'

    expect(timeLabel(instant, '')).toBe('3:30 AM')
    expect(timeLabel(instant, 'Mars/Olympus')).toBe('3:30 AM')
    expect(
      groupByDay(
        [entry('attempt', instant)],
        new Date('2026-08-28T16:00:00.000Z'),
        'Mars/Olympus',
      )[0],
    ).toMatchObject({ key: '2026-08-28', label: 'Today' })
  })

  it('groups around local midnight instead of UTC midnight', () => {
    const groups = groupByDay(
      [
        entry('before-local-midnight', '2026-08-28T03:30:00.000Z'),
        entry('after-local-midnight', '2026-08-28T04:30:00.000Z'),
      ],
      new Date('2026-08-28T16:00:00.000Z'),
      'America/New_York',
    )

    expect(
      groups.map(({ key, label, entries }) => ({
        key,
        label,
        ids: entries.map(({ id }) => id),
      })),
    ).toEqual([
      { key: '2026-08-28', label: 'Today', ids: ['after-local-midnight'] },
      { key: '2026-08-27', label: 'Yesterday', ids: ['before-local-midnight'] },
    ])
  })

  it('keeps spring-forward instants on the correct local day', () => {
    const groups = groupByDay(
      [
        entry('before-jump', '2026-03-08T06:30:00.000Z'),
        entry('after-jump', '2026-03-08T07:30:00.000Z'),
      ],
      new Date('2026-03-09T04:30:00.000Z'),
      'America/New_York',
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      key: '2026-03-08',
      label: 'Yesterday',
      entries: [{ id: 'after-jump' }, { id: 'before-jump' }],
    })
    expect(timeLabel('2026-03-08T06:30:00.000Z', 'America/New_York')).toBe('1:30 AM')
    expect(timeLabel('2026-03-08T07:30:00.000Z', 'America/New_York')).toBe('3:30 AM')
  })

  it('labels dates using the same explicit timezone as grouping', () => {
    const instant = '2026-08-28T03:30:00.000Z'
    const now = new Date('2026-08-28T16:00:00.000Z')

    expect(dayLabel(instant, now, 'America/New_York')).toBe('Yesterday')
    expect(dayLabel(instant, now, 'Europe/London')).toBe('Today')
  })
})
