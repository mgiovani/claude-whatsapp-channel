import { describe, test, expect } from 'bun:test'
import { storeRecent } from './util.ts'

describe('storeRecent', () => {
  test('stores and retrieves by ID', () => {
    const map = new Map<string, any>()
    storeRecent('id1', { text: 'hi' }, map, 10)
    expect(map.get('id1')).toEqual({ text: 'hi' })
  })

  test('evicts oldest when over capacity', () => {
    const map = new Map<string, any>()
    storeRecent('id1', 'first', map, 2)
    storeRecent('id2', 'second', map, 2)
    storeRecent('id3', 'third', map, 2) // should evict id1
    expect(map.has('id1')).toBe(false)
    expect(map.has('id2')).toBe(true)
    expect(map.has('id3')).toBe(true)
  })

  test('keeps all entries below capacity', () => {
    const map = new Map<string, any>()
    storeRecent('a', 1, map, 5)
    storeRecent('b', 2, map, 5)
    expect(map.size).toBe(2)
  })
})
