// Downloads the 10 test songs from CLAUDE.md ("测试案例") into data/songsterr/, pinned to their revisions.
// Serial and rate limited; files that are already cached are not requested again.
import path from 'node:path'
import { SongsterrClient } from '../server/src/songsterr/client.ts'
import { FIXTURES } from '../web/src/fixtures.ts'

const client = new SongsterrClient({ cacheDir: path.resolve(import.meta.dirname, '../data/songsterr') })

for (const fixture of FIXTURES) {
  const meta = await client.getMeta(fixture.songId, fixture.revisionId)
  await client.getAllTracks(meta)
  console.log(`#${fixture.no} ${meta.artist} - ${meta.title}: ${meta.tracks.length} tracks`)
}
