/**
 * jsdom tests wait on async state (schema list, query results). The files run in
 * parallel workers, so the default one-second async timeout flakes on a busy
 * machine; give every `findBy*` / `waitFor` the same room the suite already
 * allows a whole test.
 */
import { configure } from '@testing-library/react'
import { afterEach } from 'vitest'

import { clearTableSnapshots } from '../src/client/tablecache'

configure({ asyncUtilTimeout: 4000 })

// Table tabs keep their last result in memory so reopening one does not query
// again. Tests render many tabs with the same coordinates, so every case starts
// from a clean cache.
afterEach(() => {
  clearTableSnapshots()
})
