import type { client } from '~/stores/clientStore.js'
import { setFlagDraft } from '~/stores/roomViewStore'
import { createLogger } from '~/utils/log.js'

const { error } = createLogger('room')

/**
 * After creating a flag the server needs a moment to register it, so an
 * immediate gen-unique-flag-name can still return the name we just used.
 * Retry with a short backoff until we get a different name (or give up).
 */
export function regenerateUniqueFlagName(
  c: NonNullable<ReturnType<typeof client>>,
  usedName: string,
  shard: string | null,
  retries = 4,
): void {
  c.http.game.genUniqueFlagName(shard)
    .then((res) => {
      if (res.name === usedName && retries > 0) {
        setTimeout(() => regenerateUniqueFlagName(c, usedName, shard, retries - 1), 200)
        return
      }
      setFlagDraft((prev) => ({ ...prev, name: res.name }))
    })
    .catch((err) => error('gen unique flag name failed:', err))
}
